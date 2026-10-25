import { expect, test, type Page } from '@playwright/test'
async function open(page: Page, extension: string, content: string) {
  const path = `Notes/print-${Date.now()}.${extension}`
  expect((await page.request.post('/api/files/create', { data: { path, content } })).ok()).toBe(
    true,
  )
  await page.request.post('/api/settings/autoSave', {
    data: { filePath: path, enabled: false, readOnly: false },
  })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await expect(page.getByRole('textbox', { name: /editor$/ })).toBeVisible()
  return path
}
async function nativePrint(page: Page) {
  await page.evaluate(() =>
    Object.assign(window, {
      printedText: null,
      derpDesktop: {
        printFrame: async (name: string) => {
          const doc = document.querySelector<HTMLIFrameElement>(
            `iframe[name="${name}"]`,
          )!.contentDocument!
          Object.assign(window, {
            printedText: {
              text: doc.body.textContent,
              html: doc.body.innerHTML,
              css: doc.querySelector('style')?.textContent,
              images: [...doc.images].map((img) => ({ width: img.naturalWidth, alt: img.alt })),
            },
          })
        },
        cancelPrint: async () => {},
      },
    }),
  )
}
const printed = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          printedText: {
            text: string
            html: string
            css: string
            images: { width: number; alt: string }[]
          }
        }
      ).printedText,
  )
test('prints the whole unsaved source beyond the editor viewport and keeps the file unchanged', async ({
  page,
}) => {
  const path = await open(page, 'txt', 'Original')
  const content =
    Array.from({ length: 700 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n<script>literal</script>'
  await page.getByRole('textbox', { name: /editor$/ }).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(content)
  await nativePrint(page)
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Print document', exact: true })
  await expect(
    dialog.getByText('Includes your current unsaved changes.', { exact: false }),
  ).toBeVisible()
  const preview = page.frameLocator('iframe[title="Document print preview"]')
  await expect(preview.locator('pre.source')).toContainText('Line 700')
  await expect(preview.locator('script')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog).toBeHidden()
  const output = await printed(page)
  expect(output.text).toContain('Line 700\n<script>literal</script>')
  expect(output.html).not.toContain('<script>')
  expect(
    (await (await page.request.get(`/api/files/text?path=${encodeURIComponent(path)}`)).json())
      .content,
  ).toBe('Original')
  await expect(page.locator('iframe[title="Text print document"]')).toHaveCount(0)
})
test('formatted Markdown includes tables, tasks, images and references, with a source option', async ({
  page,
}) => {
  await open(
    page,
    'md',
    '# Print heading\n\n**Bold** and [link](https://example.com)\n\n- [x] completed\n\n| Name | Value |\n|---|---|\n|A|12|\n\n![Photo][image]\n\n[image]: /Images/photo.jpg\n\n<script>window.printAttack = true</script>',
  )
  await nativePrint(page)
  await page.getByRole('button', { name: 'Print document', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print document', exact: true })
  const preview = page.frameLocator('iframe[title="Document print preview"]')
  await expect(preview.getByRole('heading', { name: 'Print heading' })).toBeVisible()
  await expect(preview.locator('td').last()).toHaveText('12')
  await expect
    .poll(() =>
      preview
        .getByRole('img', { name: 'Photo' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await preview.getByRole('link', { name: 'link', exact: true }).dispatchEvent('click')
  await expect(preview.getByRole('heading', { name: 'Print heading' })).toBeVisible()
  await dialog.getByLabel('Print content').selectOption('source')
  await expect(preview.locator('pre.source')).toContainText('# Print heading')
  await dialog.getByLabel('Print content').selectOption('markdown')
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog).toBeHidden()
  const output = await printed(page)
  expect(output.html).toContain('<strong>Bold</strong>')
  expect(output.images[0]?.width).toBeGreaterThan(0)
  expect(output.html).not.toContain('<script>')
})
test('narrow print dialog validates source ranges and keeps original line numbers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, 'txt', 'first\nsecond\nthird\nfourth')
  await nativePrint(page)
  await page.getByRole('button', { name: 'Print document', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print document', exact: true })
  await dialog.getByLabel('Print range').selectOption('lines')
  await dialog.getByLabel('From line').fill('9')
  await expect(dialog.getByRole('alert')).toContainText('line range between 1 and 4')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
  await dialog.getByLabel('From line').fill('2')
  await dialog.getByLabel('To line').fill('3')
  await dialog.getByLabel('Line numbers', { exact: true }).check()
  await dialog.getByLabel('Paper', { exact: true }).selectOption('letter')
  await dialog.getByLabel('Orientation', { exact: true }).selectOption('landscape')
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog).toBeHidden()
  const output = await printed(page)
  expect(output.text).toContain('2second3third')
  expect(output.text).not.toContain('fourth')
  expect(output.css).toContain('size:279.4mm 215.9mm')
})
test('native print errors can be retried and cancellation removes the temporary frame', async ({
  page,
}) => {
  await open(page, 'txt', 'Retry printing')
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
  await page.getByRole('button', { name: 'Print document', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print document', exact: true })
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Printer unavailable')
  await expect(page.locator('iframe[title="Text print document"]')).toHaveCount(0)
  await page.evaluate(() =>
    Object.assign(window, {
      cancelledPrint: false,
      derpDesktop: {
        printFrame: () => new Promise(() => {}),
        cancelPrint: async () => {
          Object.assign(window, { cancelledPrint: true })
        },
      },
    }),
  )
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(page.locator('iframe[title="Text print document"]')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Cancel printing', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('iframe[title="Text print document"]')).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as unknown as { cancelledPrint: boolean }).cancelledPrint),
  ).toBe(true)
  await expect(page.getByRole('textbox', { name: /editor$/ })).toBeVisible()
})
test('browser printing uses the prepared document and releases it after the print dialog closes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {
      window.top!.postMessage({ type: 'printed-source', text: document.body.textContent }, '*')
      window.dispatchEvent(new Event('afterprint'))
    }
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'printed-source')
        Object.assign(window, { browserPrinted: event.data.text })
    })
  })
  await open(page, 'txt', 'Browser print only this document')
  await page.getByRole('button', { name: 'Print document', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print document', exact: true })
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(
    await page.evaluate(() => (window as unknown as { browserPrinted: string }).browserPrinted),
  ).toContain('Browser print only this document')
  await expect(page.locator('iframe[title="Text print document"]')).toHaveCount(0)
})
test('missing images become labelled placeholders and narrow editor actions keep the title readable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const path = await open(
    page,
    'md',
    '# Heading\n\n![Missing diagram](/Images/missing-print-diagram.png)',
  )
  await page.route('**/api/media/Images/missing-print-diagram.png', (route) =>
    route.fulfill({ status: 404 }),
  )
  const title = page.getByRole('heading', { name: path.split('/').at(-1)!, exact: true })
  expect(await title.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(280)
  const close = page.getByRole('button', { name: 'Close ×', exact: true })
  expect((await close.boundingBox())!.y).toBeLessThan(35)
  await page.getByRole('button', { name: 'Print document', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print document', exact: true })
  await expect(dialog.getByRole('status')).toContainText('1 image(s) could not be loaded')
  await expect(
    page.frameLocator('iframe[title="Document print preview"]').locator('.missing-image'),
  ).toHaveText('[Image: Missing diagram]')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
  expect(
    await page
      .frameLocator('iframe[title="Document print preview"]')
      .locator('html')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('textbox', { name: /editor$/ })).toBeVisible()
})
