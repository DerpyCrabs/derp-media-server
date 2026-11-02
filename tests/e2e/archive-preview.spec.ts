import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { READER_PDF } from '../fixtures/generate-media'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
const source = 'Documents/preview-fixture.zip'
let archiveBytes: Uint8Array
const exactText =
  '# Настройки\r\nport = 3020\r\n<script>window.archiveScriptExecuted = true</script>\r\n'
test.beforeAll(() => {
  archiveBytes = zipSync({
    'Folder/README.txt': strToU8(exactText),
    'Folder/config.json': strToU8('{"enabled":true}'),
    'photo.png': fs.readFileSync(path.join(root(), 'Images/photo.png')),
    'book.pdf': READER_PDF,
    'track.mp3': fs.readFileSync(path.join(root(), 'Music/track.mp3')),
    'clip.mp4': fs.readFileSync(path.join(root(), 'Videos/sample.mp4')),
    'binary.dat': new Uint8Array([0, 255, 17, 32]),
    'too-large.txt': new Uint8Array(33 * 1024 * 1024),
  })
  fs.writeFileSync(path.join(root(), source), archiveBytes)
})
test.afterAll(() => fs.rmSync(path.join(root(), source), { force: true }))
async function open(page: Page) {
  await page.goto(`/?dir=Documents&viewing=${encodeURIComponent(source)}`)
  const viewer = page.getByRole('dialog', { name: 'Archive contents', exact: true })
  await expect(viewer.locator('[data-file-path="Folder"]')).toBeVisible()
  return viewer
}
test('read-only text preview preserves source bytes, supports search and downloads only one entry', async ({
  page,
}) => {
  const viewer = await open(page)
  await viewer.locator('[data-file-path="Folder"]').click()
  await viewer.locator('[data-file-path="Folder/README.txt"]').click()
  const preview = page.getByRole('dialog', { name: 'Archive file preview', exact: true })
  const text = preview.getByRole('document', { name: 'Archive text preview' })
  await expect(text).toContainText('Настройки')
  await expect(text).toHaveAttribute('contenteditable', 'false')
  expect(await page.evaluate(() => 'archiveScriptExecuted' in window)).toBe(false)
  await text.click()
  await page.keyboard.press('Control+f')
  await expect(preview.getByRole('textbox', { name: 'Find', exact: true })).toBeVisible()
  await preview.getByRole('textbox', { name: 'Find', exact: true }).pressSequentially('port')
  await expect(preview.locator('.cm-searchMatch')).toHaveCount(1)
  const download = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Download file' }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('README.txt')
  expect(fs.readFileSync((await saved.path())!, 'utf8')).toBe(exactText)
  await preview.getByRole('button', { name: 'Back to archive' }).click()
  await expect(viewer.locator('[data-file-path="Folder/README.txt"]')).toBeFocused()
  expect(fs.readFileSync(path.join(root(), source)).equals(Buffer.from(archiveBytes))).toBe(true)
  expect(fs.existsSync(path.join(root(), 'Documents/Folder'))).toBe(false)
})
test('images and PDF pages preview without extracting and close back to the same archive', async ({
  page,
}) => {
  const warmed: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/warm/thumbnail/')) warmed.push(request.url())
  })
  const viewer = await open(page)
  await viewer.locator('[data-file-path="photo.png"]').click()
  const preview = page.getByRole('dialog', { name: 'Archive file preview', exact: true })
  await expect
    .poll(() =>
      preview
        .getByRole('img', { name: 'photo.png' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await preview.getByRole('button', { name: 'Actual size' }).click()
  await expect(preview.getByRole('button', { name: 'Fit image' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await viewer.locator('[data-file-path="book.pdf"]').click()
  await expect(preview.getByTestId('pdf-text-layer')).toContainText('Selectable reader text')
  await preview.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(preview.getByRole('textbox', { name: 'Preview PDF page' })).toHaveValue('2')
  await expect
    .poll(() =>
      preview.getByTestId('pdf-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width),
    )
    .toBeGreaterThan(0)
  await preview.getByRole('textbox', { name: 'Preview PDF page' }).fill('4')
  await preview.getByRole('textbox', { name: 'Preview PDF page' }).press('Enter')
  await expect(preview.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
  await preview.getByRole('button', { name: 'Back to archive' }).click()
  await expect(viewer.locator('[data-file-path="book.pdf"]')).toBeFocused()
  expect(warmed.filter((url) => /\/(photo\.png|clip\.mp4)(?:\?|$)/.test(url))).toEqual([])
})
test('audio and video previews decode and stop when closed', async ({ page }) => {
  const viewer = await open(page)
  for (const [name, tag] of [
    ['track.mp3', 'audio'],
    ['clip.mp4', 'video'],
  ]) {
    await viewer.locator(`[data-file-path="${name}"]`).click()
    const preview = page.getByRole('dialog', { name: 'Archive file preview', exact: true })
    await expect
      .poll(() => preview.locator(tag!).evaluate((media: HTMLMediaElement) => media.readyState))
      .toBeGreaterThanOrEqual(1)
    await expect(preview.locator(tag!)).not.toHaveAttribute('controls')
    await preview.locator(tag!).evaluate((media: HTMLMediaElement) => {
      media.muted = true
    })
    await preview.getByRole('button', { name: 'Play preview', exact: true }).click()
    await expect(preview.getByRole('button', { name: 'Pause preview', exact: true })).toBeVisible()
    await expect
      .poll(() => preview.locator(tag!).evaluate((media: HTMLMediaElement) => media.currentTime))
      .toBeGreaterThan(0)
    const element = await preview.locator(tag!).elementHandle()
    await preview.getByRole('button', { name: 'Back to archive' }).click()
    await expect(preview).toHaveCount(0)
    expect(
      await element!.evaluate(
        (media: HTMLMediaElement) => media.paused && !media.hasAttribute('src'),
      ),
    ).toBe(true)
  }
})
test('binary files remain downloadable, oversized entries fail clearly and keyboard preview works', async ({
  page,
  request,
}) => {
  const viewer = await open(page)
  await viewer.locator('[data-file-path="binary.dat"]').click({ modifiers: ['Control'] })
  await page.keyboard.press('Control+p')
  const preview = page.getByRole('dialog', { name: 'Archive file preview', exact: true })
  await expect(
    preview.getByText('Extract this file to open it in another application.'),
  ).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Download file' })).toBeEnabled()
  await preview.getByRole('button', { name: 'Back to archive' }).click()
  await viewer.locator('[data-file-path="too-large.txt"]').click()
  await expect(preview.getByRole('alert')).toContainText('too large to preview')
  await page.keyboard.press('Escape')
  await expect(viewer).toBeVisible()
  const response = await request.get(
    `/api/files/archive-entry?path=${encodeURIComponent(source)}&entry=Folder%2FREADME.txt`,
  )
  expect(response.headers()['content-type']).toBe('application/octet-stream')
  expect(response.headers()['content-disposition']).toContain('attachment;')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(
    (
      await request.get(
        `/api/files/archive-entry?path=${encodeURIComponent(source)}&entry=..%2Fescape`,
      )
    ).status(),
  ).toBe(400)
})
