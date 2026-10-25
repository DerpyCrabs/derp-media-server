import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
async function shelf(page: Page) {
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('menuitem', { name: /Local drafts/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Local drafts', exact: true })
  await expect(dialog.getByRole('searchbox', { name: 'Filter local drafts' })).toBeVisible()
  return dialog
}
async function seed(
  page: Page,
  drafts: { id: string; path: string; kind?: string; content: string; image?: boolean }[],
) {
  await page.evaluate(async (drafts) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('derp-editor-drafts', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('text', { keyPath: 'id' }).createIndex('path', 'path')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const items = await Promise.all(
      drafts.map(async (draft) => {
        let attachment: Blob | undefined
        if (draft.image) {
          const canvas = document.createElement('canvas')
          canvas.width = 80
          canvas.height = 60
          const context = canvas.getContext('2d')!
          context.fillStyle = '#ff0000'
          context.fillRect(0, 0, 80, 60)
          attachment = await new Promise<Blob>((resolve) =>
            canvas.toBlob((blob) => resolve(blob!), 'image/png'),
          )
        }
        return { ...draft, attachment, version: 'source-version', updatedAt: Date.now() }
      }),
    )
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('text', 'readwrite')
      for (const item of items) tx.objectStore('text').put(item)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    const channel = new BroadcastChannel('derp-document-drafts')
    channel.postMessage('changed')
    channel.close()
  }, drafts)
}
test('an orphaned text draft remains discoverable and can be saved without the original file', async ({
  page,
}) => {
  const source = `Notes/orphan-${Date.now()}.txt`
  await page.request.post('/api/files/create', { data: { path: source, content: 'Original text' } })
  await page.request.post('/api/settings/autoSave', {
    data: { filePath: source, enabled: false, readOnly: false },
  })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(source)}`)
  const editor = page.getByRole('textbox', { name: /editor$/ })
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('Unsaved work after the original disappears\nSecond line')
  await expect(
    page.getByText('Unsaved changes · Draft backed up in this browser', { exact: true }),
  ).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/?dir=Notes')
  fs.rmSync(path.join(root(), source))
  const dialog = await shelf(page)
  await dialog.getByRole('button', { name: new RegExp(path.basename(source)) }).click()
  await expect(dialog.getByLabel('Draft preview')).toContainText(
    'Unsaved work after the original disappears',
  )
  await dialog.getByRole('button', { name: 'Open original' }).click()
  await expect(dialog.getByRole('alert')).toContainText('original file is unavailable')
  await dialog.getByRole('button', { name: 'Save copy…' }).click()
  const save = page.getByRole('dialog', { name: 'Save recovered copy' })
  const name = `recovered-orphan-${Date.now()}.txt`
  await save.getByRole('textbox', { name: 'File name', exact: true }).fill(name)
  await save.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText(`Saved Notes/${name}`)
  expect(fs.readFileSync(path.join(root(), 'Notes', name), 'utf8')).toBe(
    'Unsaved work after the original disappears\nSecond line',
  )
  await dialog.getByRole('button', { name: 'Discard…' }).click()
  await dialog.getByRole('button', { name: 'Discard backup', exact: true }).click()
  await expect(dialog.getByText('No local drafts to recover.')).toBeVisible()
  expect(fs.existsSync(path.join(root(), 'Notes', name))).toBe(true)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Places', exact: true })).toHaveCount(0)
})
test('image edits and PDF values can be downloaded without their source documents', async ({
  page,
}) => {
  await page.goto('/?dir=Documents')
  await seed(page, [
    {
      id: 'image-backup',
      path: 'Missing/photo.png',
      kind: 'image',
      image: true,
      content: JSON.stringify({ width: 60, height: 80, matrix: [0, 1, -1, 0, 60, 0] }),
    },
    {
      id: 'pdf-backup',
      path: 'Missing/form.pdf',
      kind: 'pdf',
      content: JSON.stringify({ field: { name: 'Name', value: 'Мария' } }),
    },
  ])
  const dialog = await shelf(page)
  await dialog.getByRole('button', { name: /photo.png/ }).click()
  await expect
    .poll(() =>
      dialog
        .getByRole('img', { name: 'Recovered image preview' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(60)
  let pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download draft', exact: true }).click()
  const image = await pending
  const png = fs.readFileSync((await image.path())!)
  expect(png.readUInt32BE(16)).toBe(60)
  expect(png.readUInt32BE(20)).toBe(80)
  await dialog.getByRole('button', { name: /form.pdf/ }).click()
  await expect(dialog.getByLabel('Draft preview')).toContainText('Мария')
  pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download values', exact: true }).click()
  expect(JSON.parse(fs.readFileSync((await (await pending).path())!, 'utf8')).field.value).toBe(
    'Мария',
  )
  await expect(dialog.getByRole('button', { name: /photo.png/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /form.pdf/ })).toBeVisible()
})
test('discarding an outdated preview cannot delete a newer backup from another window', async ({
  page,
}) => {
  await page.goto('/?dir=Documents')
  await seed(page, [
    { id: 'concurrent', path: 'Missing/important.txt', kind: 'text', content: 'First version' },
  ])
  const dialog = await shelf(page)
  await dialog.getByRole('button', { name: /important.txt/ }).click()
  await expect(dialog.getByLabel('Draft preview')).toHaveText('First version')
  await seed(page, [
    { id: 'concurrent', path: 'Missing/important.txt', kind: 'text', content: 'Newer version' },
  ])
  await dialog.getByRole('button', { name: 'Discard…' }).click()
  await dialog.getByRole('button', { name: 'Discard backup', exact: true }).click()
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'changed in another window' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: /important.txt/ }).click()
  await expect(dialog.getByLabel('Draft preview')).toHaveText('Newer version')
})
test('an active editor recreates its backup on close if another view discarded it', async ({
  page,
}) => {
  const source = `Notes/live-draft-${Date.now()}.txt`
  await page.request.post('/api/files/create', { data: { path: source, content: 'Original' } })
  await page.request.post('/api/settings/autoSave', {
    data: { filePath: source, enabled: false, readOnly: false },
  })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(source)}`)
  const editor = page.getByRole('textbox', { name: /editor$/ })
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('Still open and unsaved')
  await expect(
    page.getByText('Unsaved changes · Draft backed up in this browser', { exact: true }),
  ).toBeVisible()
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('derp-editor-drafts', 1)
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('text', 'readwrite')
      tx.objectStore('text').clear()
      tx.oncomplete = () => resolve()
    })
    db.close()
  })
  await page.getByRole('button', { name: 'Close', exact: false }).filter({ hasText: '×' }).click()
  const dialog = await shelf(page)
  await dialog.getByRole('button', { name: new RegExp(path.basename(source)) }).click()
  await expect(dialog.getByLabel('Draft preview')).toHaveText('Still open and unsaved')
})
test('reading notes export as Markdown and recovery controls fit a narrow window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?dir=Documents')
  await seed(page, [
    {
      id: 'note-backup',
      path: 'Missing/book.pdf',
      kind: 'reader-note',
      content: JSON.stringify({
        id: 'draft-id',
        label: 'Quoted thought',
        quote: 'Selected passage',
        note: 'My comment',
        fingerprint: 'old-document',
        location: { kind: 'paged', pageIndex: 3 },
        original: null,
      }),
    },
  ])
  const dialog = await shelf(page)
  await dialog.getByRole('button', { name: /book.pdf/ }).click()
  await expect(dialog.getByLabel('Draft preview')).toContainText('My comment')
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download draft', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('book-recovered.md')
  const markdown = fs.readFileSync((await download.path())!, 'utf8')
  expect(markdown).toContain('Page 4')
  expect(markdown).toContain('> Selected passage')
  expect(markdown).toContain('My comment')
})
