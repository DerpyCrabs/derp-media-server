import { waitForDocumentDraft } from './document-draft-helpers'
import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
const original =
  '\uFEFFfirst = old\r\n' +
  Array.from({ length: 12 }, (_, i) => `unchanged ${i}\r\n`).join('') +
  'last = old\r\n'
async function read(page: Page, path: string) {
  return (
    await page.request.get(`/api/files/text?path=${encodeURIComponent(path)}`)
  ).json() as Promise<{ content: string; version: string }>
}
async function changeServer(page: Page, path: string, content: string) {
  expect((await page.request.post('/api/files/edit', { data: { path, content } })).ok()).toBe(true)
}
async function setup(page: Page) {
  const path = `Notes/compare-${Date.now()}.txt`
  expect(
    (await page.request.post('/api/files/create', { data: { path, content: original } })).ok(),
  ).toBe(true)
  await page.request.post('/api/settings/autoSave', {
    data: { filePath: path, enabled: false, readOnly: false },
  })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  const editor = page.getByRole('textbox', { name: /compare-.*\.txt editor$/ })
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.insertText('last = mine')
  const remote = original.replace('first = old', 'first = remote')
  await changeServer(page, path, remote)
  await page.getByRole('button', { name: 'Review changes…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Review file changes', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'Reviewed version', exact: true })).toBeVisible()
  return { path, remote, dialog }
}

test('review copies individual server changes with keyboard and preserves exact BOM/CRLF text until explicit save', async ({
  page,
}) => {
  const { path, remote, dialog } = await setup(page)
  await expect(dialog.getByRole('status')).toHaveText('2 changes')
  const accept = dialog.getByRole('button', { name: 'Use this server change', exact: true }).first()
  await accept.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('textbox', { name: 'Reviewed version' })).toContainText(
    'first = remote',
  )
  await expect(dialog.getByRole('textbox', { name: 'Reviewed version' })).toContainText(
    'last = mine',
  )
  await expect(dialog.getByRole('status')).toHaveText('1 change')
  await dialog.getByRole('button', { name: 'Comparison actions' }).click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('2 changes')
  await dialog.getByRole('button', { name: 'Comparison actions' }).click()
  await page.getByRole('menuitem', { name: 'Redo', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('1 change')
  await page.request.post('/api/settings/autoSave', {
    data: { filePath: path, enabled: true, readOnly: false },
  })
  await dialog.getByRole('button', { name: 'Use reviewed version', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.waitForTimeout(2200)
  expect((await read(page, path)).content).toBe(remote)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => (await read(page, path)).content)
    .toBe(remote.replace('last = old', 'last = mine'))
})

test('a new remote revision blocks completion while preserving edits and allows reviewing the latest version', async ({
  page,
}) => {
  const { path, remote, dialog } = await setup(page)
  const editor = dialog.getByRole('textbox', { name: 'Reviewed version', exact: true })
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('typed during review\n')
  await changeServer(page, path, remote.replace('unchanged 3', 'remote changed again'))
  await expect(dialog.getByRole('alert')).toContainText(
    'The file changed again while you were reviewing it.',
  )
  await expect(
    dialog.getByRole('button', { name: 'Use reviewed version', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: 'Review latest server version', exact: true }).click()
  await expect(dialog.getByRole('document', { name: 'Server version', exact: true })).toContainText(
    'remote changed again',
  )
  await expect(editor).toContainText('typed during review')
  await expect(
    dialog.getByRole('button', { name: 'Use reviewed version', exact: true }),
  ).toBeEnabled()
  await dialog.getByRole('button', { name: 'Close comparison', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /compare-.*\.txt editor$/ })).toContainText(
    'typed during review',
  )
  expect((await read(page, path)).content).not.toContain('typed during review')
  await waitForDocumentDraft(page, path, 'typed during review')
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: 'Document actions' }).click()
  await page.getByRole('menuitem', { name: 'Restore unsaved changes', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /compare-.*\.txt editor$/ })).toContainText(
    'typed during review',
  )
})

test('the server side is read only, entire-version acceptance can be undone, and a narrow comparison closes without losing edits', async ({
  page,
}) => {
  const { path, remote, dialog } = await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const server = dialog.getByRole('document', { name: 'Server version', exact: true })
  await server.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('do not replace server')
  await expect(server).toContainText('first = remote')
  await dialog.getByRole('button', { name: 'Comparison actions' }).click()
  await page.getByRole('menuitem', { name: 'Use entire server version', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('0 changes')
  await dialog.getByRole('button', { name: 'Comparison actions' }).click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(
    dialog.getByRole('textbox', { name: 'Reviewed version', exact: true }),
  ).toContainText('last = mine')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: /compare-.*\.txt editor$/ })).toContainText(
    'last = mine',
  )
  expect((await read(page, path)).content).toBe(remote)
})

for (const width of [1280, 390]) {
  test(`copying mixed line endings preserves exact server bytes (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const { path, remote, dialog } = await setup(page)
    if (width < 600) {
      await expect(dialog.locator('.cm-mergeView')).toHaveCount(0)
      expect(
        await dialog
          .locator('.text-merge-surface')
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true)
    }
    const exact = remote.replace('first = remote\r\n', 'first = mixed\r').replace(/\r\n$/, '')
    await changeServer(page, path, exact)
    await dialog.getByRole('button', { name: 'Review latest server version', exact: true }).click()
    await dialog
      .getByRole('button', { name: 'Use this server change', exact: true })
      .first()
      .click()
    await dialog
      .getByRole('button', { name: 'Use this server change', exact: true })
      .first()
      .click()
    await expect(dialog.getByRole('status')).toHaveText('0 changes')
    await dialog.getByRole('button', { name: 'Use reviewed version', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Document actions' }).click()
    await page.getByRole('menuitem', { name: 'Download', exact: true }).click()
    const downloaded = await downloading
    expect(fs.readFileSync((await downloaded.path())!, 'utf8')).toBe(exact)
    expect((await read(page, path)).content).toBe(exact)
    await expect(page.locator('footer[role="status"]')).toHaveCount(0)
  })
}

test('oversized comparisons keep the draft available without attempting an unbounded diff', async ({
  page,
}) => {
  const { path, dialog } = await setup(page)
  await changeServer(page, path, 'remote '.repeat(310000))
  await dialog.getByRole('button', { name: 'Review latest server version', exact: true }).click()
  await expect(dialog.getByText('This file is too large for comparison.')).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Use reviewed version', exact: true }),
  ).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close comparison', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /compare-.*\.txt editor$/ })).toContainText(
    'last = mine',
  )
})
