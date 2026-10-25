import { test, expect } from '@playwright/test'
import { READER_PDF } from '../fixtures/generate-media'

test('Ctrl+P prints only the requested PDF pages and disposes the print document', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {
      window.top!.postMessage(
        {
          type: 'test-pdf-print',
          pages: Array.from(document.querySelectorAll('img')).map((image) => ({
            name: image.alt,
            width: image.naturalWidth,
            height: image.naturalHeight,
          })),
        },
        '*',
      )
      window.dispatchEvent(new Event('afterprint'))
    }
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'test-pdf-print')
        (window as Window & { printedPages?: unknown }).printedPages = event.data.pages
    })
  })
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: READER_PDF, contentType: 'application/pdf' }),
  )
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.getByTestId('reader-viewport').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Print PDF', exact: true })
  await dialog.getByRole('textbox', { name: 'Pages to print' }).fill('2, 4')
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as Window & { printedPages?: unknown }).printedPages))
    .toEqual([
      { name: 'Page 2', width: 1275, height: 1651 },
      { name: 'Page 4', width: 1275, height: 1651 },
    ])
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('iframe[title="PDF print document"]')).toHaveCount(0)
  await expect(page.getByTestId('reader-dialog')).toBeVisible()
})

test('print options are available from settings, validate ranges and cancel without closing the reader', async ({
  page,
}) => {
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: READER_PDF, contentType: 'application/pdf' }),
  )
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  await page.getByRole('button', { name: 'Print…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print PDF', exact: true })
  await dialog.getByRole('textbox', { name: 'Pages to print' }).fill('1-99')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: 'Current page', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('reader-dialog')).toBeVisible()
})

test('native printing keeps its prepared frame until the bridge finishes and supports cancellation', async ({
  page,
}) => {
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: READER_PDF, contentType: 'application/pdf' }),
  )
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.evaluate(() => {
    let finish = () => {}
    Object.assign(window, {
      nativePrintName: '',
      nativePrintCancelled: '',
      finishNativePrint: () => finish(),
      derpDesktop: {
        printFrame: (name: string) => {
          Object.assign(window, { nativePrintName: name })
          return new Promise<void>((resolve) => {
            finish = resolve
          })
        },
        cancelPrint: async (name: string) => {
          Object.assign(window, { nativePrintCancelled: name })
          finish()
        },
      },
    })
  })
  const open = async () => {
    await page.getByTestId('reader-viewport').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: 'Print PDF', exact: true })
    await dialog.getByRole('textbox', { name: 'Pages to print' }).fill('2')
    await dialog.getByRole('button', { name: 'Print', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as Window & { nativePrintName: string }).nativePrintName,
        ),
      )
      .toMatch(/^derp-print-/)
    return dialog
  }
  const dialog = await open()
  const name = await page.evaluate(
    () => (window as unknown as Window & { nativePrintName: string }).nativePrintName,
  )
  await expect(page.locator(`iframe[name="${name}"]`)).toHaveCount(1)
  expect(
    await page
      .locator(`iframe[name="${name}"]`)
      .contentFrame()
      .getByRole('img', { name: 'Page 2' })
      .getAttribute('src'),
  ).toMatch(/^blob:/)
  await expect(dialog).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as Window & { finishNativePrint: () => void }).finishNativePrint(),
  )
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('iframe[title="PDF print document"]')).toHaveCount(0)
  await page.evaluate(() =>
    Object.assign(window, { nativePrintName: '', nativePrintCancelled: '' }),
  )
  const second = await open()
  const secondName = await page.evaluate(
    () => (window as unknown as Window & { nativePrintName: string }).nativePrintName,
  )
  await second.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Window & { nativePrintCancelled: string }).nativePrintCancelled,
      ),
    )
    .toBe(secondName)
  await expect(page.locator('iframe[title="PDF print document"]')).toHaveCount(0)
  await expect(page.getByTestId('reader-dialog')).toBeVisible()
})

test('native printing errors leave a retryable dialog and release the prepared frame', async ({
  page,
}) => {
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: READER_PDF, contentType: 'application/pdf' }),
  )
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await page.evaluate(() =>
    Object.assign(window, {
      derpDesktop: {
        printFrame: async () => {
          throw new Error('Printer unavailable')
        },
        cancelPrint: async () => {},
      },
    }),
  )
  await page.getByTestId('reader-viewport').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Print PDF', exact: true })
  await dialog.getByRole('button', { name: 'Current page' }).click()
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Printer unavailable')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
  await expect(page.locator('iframe[title="PDF print document"]')).toHaveCount(0)
})
