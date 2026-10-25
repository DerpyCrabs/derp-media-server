import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { READER_PDF } from '../fixtures/generate-media'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
let serial = 0
async function open(page: Page) {
  const source = `Documents/notes-${Date.now()}-${serial++}.pdf`
  fs.writeFileSync(path.join(root(), source), READER_PDF)
  await page.goto(`/?dir=Documents&viewing=${encodeURIComponent(source)}`)
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.keyboard.press('Control+b')
  const panel = page.getByRole('region', { name: 'Reading notes' })
  await expect(panel.getByRole('button', { name: 'Bookmark this location' })).toBeEnabled()
  return { source, panel }
}
test('bookmarks save, navigate, export and delete without changing the PDF', async ({ page }) => {
  const { source, panel } = await open(page)
  const original = fs.readFileSync(path.join(root(), source))
  await page.getByTestId('reader-page-indicator').click()
  await page.getByTestId('reader-page-input').fill('3')
  await page.getByTestId('reader-page-input').press('Enter')
  await expect
    .poll(() => page.getByTestId('reader-viewport').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1500)
  await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
  await panel.getByRole('button', { name: 'Bookmark this location' }).click()
  await panel.getByLabel('Title', { exact: true }).fill('Вернуться к главному')
  await panel.getByLabel('Note', { exact: true }).fill('Read this again tomorrow.')
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(
    panel.getByRole('button', { name: 'Вернуться к главному', exact: true }),
  ).toBeVisible()
  await page.getByTestId('reader-page-indicator').click()
  await page.getByTestId('reader-page-input').fill('1')
  await page.getByTestId('reader-page-input').press('Enter')
  await expect
    .poll(() => page.getByTestId('reader-viewport').evaluate((el) => el.scrollTop))
    .toBe(0)
  await panel.getByRole('button', { name: 'Вернуться к главному', exact: true }).click()
  await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
  const downloadPromise = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export notes' }).click()
  const download = await downloadPromise
  const text = fs.readFileSync((await download.path())!, 'utf8')
  expect(text).toContain('Вернуться к главному')
  expect(text).toContain('Read this again tomorrow.')
  expect(fs.readFileSync(path.join(root(), source)).equals(original)).toBe(true)
  await panel.getByRole('button', { name: 'Delete', exact: true }).click()
  await panel.getByRole('button', { name: 'Delete note', exact: true }).click()
  await expect(panel.getByText('Read this again tomorrow.')).toHaveCount(0)
})
test('unfinished notes recover after a reload and save once', async ({ page }) => {
  const { source, panel } = await open(page)
  await panel.getByRole('button', { name: 'Bookmark this location' }).click()
  await panel.getByLabel('Title', { exact: true }).fill('Recovered bookmark')
  await panel.getByLabel('Note', { exact: true }).fill('Unfinished thoughts')
  await expect(panel.getByText('Draft backed up in this browser')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.keyboard.press('Control+b')
  await panel.getByRole('button', { name: 'Restore note' }).click()
  await expect(panel.getByLabel('Note', { exact: true })).toHaveValue('Unfinished thoughts')
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Recovered bookmark', exact: true })).toBeVisible()
  expect(
    (await (await page.request.get(`/api/reader-notes?path=${encodeURIComponent(source)}`)).json())
      .items,
  ).toHaveLength(1)
  await page.reload()
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.keyboard.press('Control+b')
  await expect(panel.getByRole('button', { name: 'Recovered bookmark', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Restore note' })).toHaveCount(0)
})
test('a stale edit keeps the typed note and cannot overwrite another window', async ({ page }) => {
  const { source, panel } = await open(page)
  await panel.getByRole('button', { name: 'Bookmark this location' }).click()
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await panel.getByLabel('Note', { exact: true }).fill('Local thoughts')
  const data = await (
    await page.request.get(`/api/reader-notes?path=${encodeURIComponent(source)}`)
  ).json()
  const note = data.items[0]
  expect(
    (
      await page.request.patch(`/api/reader-notes/${note.id}`, {
        data: {
          path: source,
          revision: note.revision,
          label: 'Other window',
          note: 'Remote thoughts',
        },
      })
    ).ok(),
  ).toBe(true)
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(panel.getByRole('alert').filter({ hasText: 'another window' })).toBeVisible()
  await expect(panel.getByLabel('Note', { exact: true })).toHaveValue('Local thoughts')
  await panel.getByRole('button', { name: 'Keep as new note', exact: true }).click()
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(panel.getByText('Local thoughts', { exact: true })).toBeVisible()
  expect(
    (await (await page.request.get(`/api/reader-notes?path=${encodeURIComponent(source)}`)).json())
      .items,
  ).toHaveLength(2)
  await panel.getByRole('button', { name: 'Other window', exact: true }).click()
  await expect(panel.getByText('Remote thoughts', { exact: true })).toBeVisible()
})
test('selected PDF text becomes a quoted note and remains available after the document changes', async ({
  page,
}) => {
  const { source, panel } = await open(page)
  await page.getByRole('button', { name: 'Close document outline' }).click()
  await page.getByTestId('reader-settings-button').click()
  await page.getByRole('button', { name: 'none', exact: true }).click()
  await page
    .getByTestId('pdf-text-layer')
    .first()
    .evaluate((layer) => {
      const span = [...layer.querySelectorAll('span')].find((item) =>
        item.textContent?.includes('Selectable reader text'),
      )!
      const range = document.createRange()
      range.selectNodeContents(span)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      const rect = span.getBoundingClientRect()
      span.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: rect.right - 2,
          clientY: rect.top + 5,
        }),
      )
    })
  await page.getByRole('button', { name: 'Save quote', exact: true }).click()
  await expect(panel.locator('blockquote')).toContainText('Selectable reader text begins here')
  await panel.getByLabel('Title', { exact: true }).fill('Quoted passage')
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Quoted passage', exact: true })).toBeEnabled()
  fs.appendFileSync(path.join(root(), source), '\n% Updated copy\n')
  await page.reload()
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.keyboard.press('Control+b')
  await expect(panel.getByRole('button', { name: 'Quoted passage', exact: true })).toBeDisabled()
  await expect(panel.getByText('Earlier document version · location unavailable')).toBeVisible()
  await expect(panel.locator('blockquote')).toContainText('Selectable reader text begins here')
})
test('EPUB bookmarks use chapters and the notes panel fits a narrow reader', async ({ page }) => {
  const source = `Documents/book-notes-${Date.now()}.epub`
  fs.copyFileSync(path.join(root(), 'Documents/reader.epub'), path.join(root(), source))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/?dir=Documents&viewing=${encodeURIComponent(source)}`)
  await expect(page.getByTestId('reader-book')).toBeVisible()
  await page.keyboard.press('Control+b')
  const panel = page.getByRole('region', { name: 'Reading notes' })
  await panel.getByRole('button', { name: 'Bookmark this location' }).click()
  await panel.getByLabel('Title', { exact: true }).fill('Book bookmark')
  await panel.getByLabel('Note', { exact: true }).fill('A book, not a PDF page')
  await panel.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Book bookmark', exact: true })).toBeVisible()
  const bounds = await panel.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  const data = await (
    await page.request.get(`/api/reader-notes?path=${encodeURIComponent(source)}`)
  ).json()
  expect(data.items[0].location.kind).toBe('book')
  expect(data.items[0].location.chapterId).toBeTruthy()
  await panel.getByRole('button', { name: 'Book bookmark', exact: true }).click()
  await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')
})
