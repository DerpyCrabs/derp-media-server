import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { docxFixture, odtFixture, wordXml, paragraph } from '../fixtures/office-documents'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
const files: string[] = []
async function open(page: Page, bytes: Uint8Array, extension: string) {
  const source = `Documents/office-${crypto.randomUUID()}.${extension}`
  files.push(source)
  fs.writeFileSync(path.join(root(), source), bytes)
  await page.goto(`/?dir=Documents&viewing=${encodeURIComponent(source)}`)
  return source
}
test.afterAll(() => {
  for (const file of files) fs.rmSync(path.join(root(), file), { force: true })
})

test('DOCX opens as a document with searchable structure, merged tables, local images and unchanged original download', async ({
  page,
  request,
}) => {
  const external: string[] = [],
    errors: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('external.invalid')) external.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  const bytes = docxFixture(),
    source = await open(page, bytes, 'docx')
  const content = page.locator('.book-document')
  await expect(content.getByRole('heading', { name: 'Project overview' })).toBeVisible()
  await expect(content.locator('strong').filter({ hasText: 'Important note' })).toBeVisible()
  await expect(content.getByRole('cell', { name: 'Merged cell' })).toHaveAttribute('rowspan', '2')
  await expect(content.getByRole('img', { name: 'Embedded image' })).toBeVisible()
  await expect(content.locator('ol').first()).toHaveCSS('list-style-type', 'decimal')
  await expect(content.locator('ol').nth(1)).toHaveAttribute('start', '2')
  await expect(content.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  )
  await expect(content).not.toContainText('Deleted wording')
  const listing = await (await request.get('/api/files?dir=Documents')).json()
  expect(listing.files.find((file: { path: string }) => file.path === source).type).toBe('document')
  await content.getByRole('link', { name: 'Jump to conclusion' }).click()
  await expect(page.getByTestId('reader-book-progress')).toContainText('Conclusion')
  await page.keyboard.press('Control+f')
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('Footnote details')
  await expect(content.getByText('Footnote details', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download original', exact: true }).click()
  const download = await downloaded
  expect(fs.readFileSync((await download.path())!).equals(Buffer.from(bytes))).toBe(true)
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('ODT reuses reader notes and nested headings and stays readable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const bytes = odtFixture(),
    source = await open(page, bytes, 'odt')
  const content = page.locator('.book-document')
  await expect(content.getByRole('heading', { name: 'Travel plan' })).toBeVisible()
  if (await page.getByTestId('reader-outline').isVisible())
    await page.getByTestId('reader-outline-button').click()
  await expect(content.locator('strong').filter({ hasText: 'traveller' })).toBeVisible()
  await expect(content.getByRole('cell', { name: 'Trip total' })).toHaveAttribute('colspan', '2')
  await content.getByRole('link', { name: 'Jump to destination' }).click()
  await expect(page.getByTestId('reader-book-progress')).toContainText('Destination')
  await page.keyboard.press('Control+b')
  const notes = page.getByRole('region', { name: 'Reading notes' })
  await notes.getByRole('button', { name: 'Bookmark this location' }).click()
  await notes.getByLabel('Title', { exact: true }).fill('Trip bookmark')
  await notes.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(notes.getByRole('button', { name: 'Trip bookmark', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('reader-book-progress')).toBeVisible()
  await page.keyboard.press('Control+b')
  await expect(notes.getByRole('button', { name: 'Trip bookmark', exact: true })).toBeVisible()
  expect(fs.readFileSync(path.join(root(), source)).equals(Buffer.from(bytes))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('malformed, encrypted and oversized office files offer the original without executing or expanding content', async ({
  page,
}) => {
  await open(
    page,
    docxFixture({
      'word/document.xml': '<!DOCTYPE document [<!ENTITY x "boom">]>' + wordXml(paragraph('&x;')),
    }),
    'docx',
  )
  await expect(page.getByRole('alert')).toContainText('entity declarations')
  await expect(
    page.getByRole('alert').getByRole('link', { name: 'Download original' }),
  ).toBeVisible()
  await open(
    page,
    odtFixture({ 'META-INF/manifest.xml': '<manifest><encryption-data/></manifest>' }),
    'odt',
  )
  await expect(page.getByRole('alert')).toContainText('Encrypted ODT')
  await page.route('**/api/media/Documents/*.docx', (route) =>
    route.fulfill({
      status: 200,
      body: Buffer.from('small'),
      headers: { 'content-length': String(65 * 1024 * 1024) },
    }),
  )
  await open(page, docxFixture(), 'docx')
  await expect(page.getByRole('alert')).toContainText('64 MB preview limit')
})

test('real Word and LibreOffice documents open from the file browser and in the native viewer route', async ({
  page,
}) => {
  for (const extension of ['docx', 'odt']) {
    const bytes = fs.readFileSync(`tests/fixtures/office-report.${extension}`)
    const source = await open(page, bytes, extension)
    await expect(page.locator('.book-document')).toContainText('Работа над проектом')
    await page.getByRole('button', { name: 'Close reader', exact: true }).click()
    await page.getByText(path.basename(source), { exact: true }).click()
    await expect(
      page.locator('.book-document').getByRole('cell', { name: 'Media server', exact: true }),
    ).toBeVisible()
    await expect(
      page.locator('.book-document').getByRole('img', { name: 'Embedded image' }),
    ).toBeVisible()
    await page.addInitScript(() =>
      Object.assign(window, {
        derpDesktop: {
          ready: async () => {},
          onOpen: () => () => {},
          onBeforeClose: () => () => {},
          close: () => {},
        },
      }),
    )
    await page.goto(`/desktop?mode=viewer&dir=Documents&viewing=${encodeURIComponent(source)}`)
    await expect(page.locator('.book-document')).toContainText('Second numbered item')
    await expect(page.getByRole('link', { name: 'Download original', exact: true })).toHaveCount(0)
  }
})
