import { waitForDocumentDraft } from './document-draft-helpers'
import { test, expect, type Page } from '@playwright/test'

async function documentAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function openDocument(page: Page, autoSave = false) {
  const path = `Notes/recovery-${Date.now()}.txt`
  expect(
    (
      await page.request.post('/api/files/create', { data: { path, content: 'Original file\n' } })
    ).ok(),
  ).toBe(true)
  expect(
    (
      await page.request.post('/api/settings/autoSave', {
        data: { filePath: path, enabled: autoSave, readOnly: false },
      })
    ).ok(),
  ).toBe(true)
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await expect(page.getByRole('textbox', { name: /editor$/ })).toBeVisible()
  return path
}
async function edit(page: Page, text: string) {
  await page.getByRole('textbox', { name: /editor$/ }).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
}
async function read(page: Page, path: string) {
  return (
    await page.request.get(`/api/files/text?path=${encodeURIComponent(path)}`)
  ).json() as Promise<{ content: string; version: string }>
}

test('a manually saved text draft survives reload and is restored without writing over the file', async ({
  page,
}) => {
  const path = await openDocument(page)
  await edit(page, 'My unsaved draft\nSecond line')
  await waitForDocumentDraft(page, path)
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await documentAction(page, 'Restore unsaved changes')
  await expect(page.getByRole('textbox', { name: /editor$/ })).toContainText('My unsaved draft')
  expect((await read(page, path)).content).toBe('Original file\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => (await read(page, path)).content)
    .toBe('My unsaved draft\nSecond line')
  await page.reload()
  await expect(page.getByRole('textbox', { name: /editor$/ })).toContainText('My unsaved draft')
  await expect(
    page.getByRole('menuitem', { name: 'Restore unsaved changes', exact: true }),
  ).toHaveCount(0)
})

test('Save As preserves a conflicting recovered draft in a new file', async ({ page }) => {
  const path = await openDocument(page)
  await edit(page, 'Unsaved before external change')
  await waitForDocumentDraft(page, path)
  expect(
    (
      await page.request.post('/api/files/edit', {
        data: { path, content: 'Changed by another app' },
      })
    ).ok(),
  ).toBe(true)
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await documentAction(page, 'Restore unsaved changes')
  await expect(
    page.getByText('This file changed elsewhere. Your unsaved edits were kept.'),
  ).toBeVisible()
  expect((await read(page, path)).content).toBe('Changed by another app')
  await page.getByRole('textbox', { name: /editor$/ }).click()
  await page.keyboard.press('Control+Shift+s')
  const dialog = page.getByRole('dialog', { name: 'Save text as', exact: true })
  const name = `recovered-copy-${Date.now()}.txt`
  await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(`Notes/${name}`)))
  expect((await read(page, path)).content).toBe('Changed by another app')
  expect((await read(page, `Notes/${name}`)).content).toBe('Unsaved before external change')
})

test('Download contains the unsaved text rather than the last saved file', async ({ page }) => {
  await openDocument(page)
  await edit(page, 'Download this unsaved text')
  const pending = page.waitForEvent('download')
  await documentAction(page, 'Download')
  const download = await pending
  const stream = await download.createReadStream()
  const buffers: Buffer[] = []
  for await (const chunk of stream!) buffers.push(Buffer.from(chunk))
  expect(Buffer.concat(buffers).toString()).toBe('Download this unsaved text')
})

test('restoring a draft does not trigger autosave even when the file now has autosave enabled', async ({
  page,
}) => {
  const path = await openDocument(page)
  await edit(page, 'Must stay a draft until reviewed')
  await waitForDocumentDraft(page, path)
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  expect(
    (
      await page.request.post('/api/settings/autoSave', {
        data: { filePath: path, enabled: true, readOnly: false },
      })
    ).ok(),
  ).toBe(true)
  await documentAction(page, 'Restore unsaved changes')
  await page.getByRole('textbox', { name: /editor$/ }).click()
  await page.locator('#text-viewer-title').click()
  await page.waitForTimeout(2300)
  expect((await read(page, path)).content).toBe('Original file\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => (await read(page, path)).content)
    .toBe('Must stay a draft until reviewed')
})

test('different browser views keep independent unsaved drafts for the same file', async ({
  page,
  context,
}) => {
  const path = await openDocument(page)
  await edit(page, 'First view draft')
  await waitForDocumentDraft(page, path)
  const other = await context.newPage()
  await other.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await edit(other, 'Second view draft')
  await waitForDocumentDraft(other, path, 'Second view draft')
  await other.getByRole('button', { name: 'Close', exact: true }).click()
  await other.close()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await documentAction(page, 'Restore unsaved changes')
  await expect(page.getByRole('textbox', { name: /editor$/ })).toContainText('Second view draft')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await read(page, path)).content).toBe('Second view draft')
  await page.reload()
  await documentAction(page, 'Restore unsaved changes')
  await expect(page.getByRole('textbox', { name: /editor$/ })).toContainText('First view draft')
  await expect(
    page.getByText('This file changed elsewhere. Your unsaved edits were kept.'),
  ).toBeVisible()
})
