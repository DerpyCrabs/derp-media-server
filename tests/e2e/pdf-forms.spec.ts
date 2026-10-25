import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const pdf = readFileSync('tests/fixtures/fillable.pdf')
test.beforeEach(async ({ page }) => {
  await page.route('**/api/reader-preferences', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? { preferences: { selectionMode: 'text' }, revision: 0 }
          : { revision: 1 },
    }),
  )
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: pdf, contentType: 'application/pdf' }),
  )
})
test('PDF form entries survive reload and download as an editable PDF', async ({ page }) => {
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  const name = page.getByRole('textbox', { name: 'Full name', exact: true })
  await expect(name).toBeVisible()
  const checkboxAppearance = page.locator('.checkBox [data-canvas-name=checked]')
  await expect(checkboxAppearance).toBeHidden()
  await name.fill('Ada Lovelace')
  await page.getByRole('checkbox', { name: 'Subscribe', exact: true }).check()
  await expect(checkboxAppearance).toBeVisible()
  await page.getByRole('combobox', { name: 'Account type', exact: true }).selectOption('Business')
  await expect(
    page.getByText('Form entries backed up in this browser', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Restore entries', exact: true }).click()
  await expect(name).toHaveValue('Ada Lovelace')
  await expect(page.getByRole('checkbox', { name: 'Subscribe', exact: true })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'Account type', exact: true })).toHaveValue(
    'Business',
  )
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('reader-filled.pdf')
  const bytes = readFileSync((await download.path())!)
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: bytes, contentType: 'application/pdf' }),
  )
  await page.reload()
  await expect(name).toHaveValue('Ada Lovelace')
  await expect(page.getByRole('checkbox', { name: 'Subscribe', exact: true })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'Account type', exact: true })).toHaveValue(
    'Business',
  )
})

test('Ctrl+S saves a separate editable copy and leaves the original unchanged', async ({
  page,
  request,
}) => {
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  const name = page.getByRole('textbox', { name: 'Full name', exact: true })
  await name.fill('Grace Hopper')
  await page.keyboard.press('Control+s')
  const dialog = page.getByRole('dialog', { name: 'Save filled PDF copy', exact: true })
  const filename = `filled-${Date.now()}.pdf`
  await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill(filename)
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText(`Saved copy: Notes/${filename}`, { exact: true })).toBeVisible()
  const response = await request.get(`/api/media/Notes/${filename}`)
  expect(response.ok()).toBeTruthy()
  const bytes = await response.body()
  expect(bytes.equals(pdf)).toBe(false)
  await page.reload()
  await expect(name).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Restore entries', exact: true })).toHaveCount(0)
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(`Notes/${filename}`)}`)
  await expect(name).toHaveValue('Grace Hopper')
})

test('changed PDF versions keep recoverable entries without applying them to new fields', async ({
  page,
}) => {
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  const name = page.getByRole('textbox', { name: 'Full name', exact: true })
  await name.fill('Saved elsewhere')
  await expect(
    page.getByText('Form entries backed up in this browser', { exact: true }),
  ).toBeVisible()
  const changed = Buffer.from(pdf.toString().replace('Application form', 'Replacement form'))
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: changed, contentType: 'application/pdf' }),
  )
  await page.reload()
  await expect(
    page.getByText('Saved form entries belong to a different version of this PDF.'),
  ).toBeVisible()
  await expect(name).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Restore entries', exact: true })).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download entries', exact: true }).click()
  const download = await downloading
  expect(readFileSync((await download.path())!, 'utf8')).toContain('Saved elsewhere')
  await page.getByRole('button', { name: 'Discard saved entries', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download entries', exact: true })).toHaveCount(0)
})

test('unmodified forms do not create recovery drafts and read-only folders allow filled downloads', async ({
  page,
}) => {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), editableFolders: [] } })
  })
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Save copy…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save filled PDF copy', exact: true })
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Download copy', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore entries', exact: true })).toHaveCount(0)
})

test('PDF printing includes current form text instead of the empty original', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      const image = document.querySelector('img')!
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 30
      const context = canvas.getContext('2d')!
      const scale = image.naturalWidth / 612
      context.drawImage(image, 50 * scale, 122 * scale, 400 * scale, 30 * scale, 0, 0, 400, 30)
      const pixels = context.getImageData(0, 0, 400, 30).data
      let dark = 0
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index]! < 100 && pixels[index + 1]! < 100 && pixels[index + 2]! < 100) dark++
      window.top!.postMessage({ type: 'printed-form', dark }, '*')
      window.dispatchEvent(new Event('afterprint'))
    }
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'printed-form')
        (window as Window & { printedFormInk?: number }).printedFormInk = event.data.dark
    })
  })
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await page
    .getByRole('textbox', { name: 'Full name', exact: true })
    .fill('Printed filled application')
  await page.keyboard.press('Control+p')
  await page
    .getByRole('dialog', { name: 'Print PDF', exact: true })
    .getByRole('button', { name: 'Print', exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { printedFormInk?: number }).printedFormInk ?? 0),
    )
    .toBeGreaterThan(150)
  await expect(page.locator('iframe[title="PDF print document"]')).toHaveCount(0)
})

test('blocked backup storage keeps unsaved forms open and still allows a server copy', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      value: () => {
        throw new DOMException('Storage blocked', 'SecurityError')
      },
    })
  })
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Keep these entries')
  await expect(
    page.getByText('Could not back up form entries. Save a copy before closing.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close reader', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Could not close document', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('dialog', { name: 'Could not close document', exact: true })
    .getByRole('button')
    .click()
  await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue(
    'Keep these entries',
  )
  await page.getByRole('button', { name: 'Save copy…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save filled PDF copy', exact: true })
  await dialog
    .getByRole('textbox', { name: 'File name', exact: true })
    .fill(`no-backup-${Date.now()}.pdf`)
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Close reader', exact: true }).click()
  await expect(page.getByTestId('reader-dialog')).not.toBeVisible()
})

test('cancelled native PDF exports retain entries and confirmed exports clear their backup', async ({
  page,
}) => {
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Native export')
  await expect(
    page.getByText('Form entries backed up in this browser', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() => {
    let count = 0
    Object.assign(window, {
      derpDesktop: {
        downloadBlob: async (url: string) => {
          const response = await fetch(url)
          if (!response.ok || (await response.blob()).size < 100)
            throw new Error('Missing export bytes')
          return ++count > 1
        },
        cancelDownload: async () => {},
      },
    })
  })
  await page.getByRole('button', { name: 'Save copy…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save filled PDF copy', exact: true })
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Download copy', exact: true })).toBeEnabled()
  await expect(dialog).toBeVisible()
  await expect(
    page.getByText('Form entries backed up in this browser', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Restore entries', exact: true })).toHaveCount(0)
})
