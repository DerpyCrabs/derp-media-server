import { expect, test } from '@playwright/test'

test('image printing respects rotation and physical dimensions, then releases the frame', async ({
  page,
}) => {
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click()
  await page.evaluate(() => {
    Object.assign(window, {
      imagePrint: null,
      derpDesktop: {
        printFrame: async (name: string) => {
          const doc = document.querySelector<HTMLIFrameElement>(
            `iframe[name="${name}"]`,
          )!.contentDocument!
          const image = doc.querySelector('img')!
          Object.assign(window, {
            imagePrint: {
              width: image.naturalWidth,
              height: image.naturalHeight,
              css: doc.querySelector('style')!.textContent,
            },
          })
        },
        cancelPrint: async () => {},
      },
    })
  })
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Print image', exact: true })
  await expect(dialog.getByRole('img', { name: 'Image placement on paper' })).toBeVisible()
  await dialog.getByLabel('Size', { exact: true }).selectOption('custom')
  await dialog.getByLabel('Image width (mm)').fill('500')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
  await dialog.getByLabel('Image width (mm)').fill('100')
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const printed = await page.evaluate(
    () =>
      (window as unknown as { imagePrint: { width: number; height: number; css: string } })
        .imagePrint,
  )
  const original = await page
    .getByRole('img', { name: 'photo.jpg', exact: true })
    .evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }))
  expect(printed.width).toBe(original.height)
  expect(printed.height).toBe(original.width)
  expect(printed.css).toContain('width:100mm')
  await expect(page.locator('iframe[title="Image print document"]')).toHaveCount(0)
})

test('copy image writes PNG pixels with rotation and reports clipboard rejection', async ({
  page,
}) => {
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async (items: ClipboardItem[]) => {
        const blob = await items[0]!.getType('image/png')
        const bitmap = await createImageBitmap(blob)
        Object.assign(window, {
          copiedImage: { type: blob.type, width: bitmap.width, height: bitmap.height },
        })
        bitmap.close()
      },
    })
  })
  const original = await page
    .getByRole('img', { name: 'photo.jpg', exact: true })
    .evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }))
  await page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click()
  await page.keyboard.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Image copied.')
  expect(
    await page.evaluate(() => (window as unknown as { copiedImage: unknown }).copiedImage),
  ).toEqual({ type: 'image/png', width: original.height, height: original.width })
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: () => Promise.reject(new Error('Permission denied')),
    }),
  )
  await page.getByRole('button', { name: 'Image actions' }).click()
  await page.getByRole('menuitem', { name: 'Copy image' }).click()
  await expect(page.getByRole('status')).toContainText('Could not copy the image')
})

test('image print cancellation leaves the viewer and compact actions usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await page.evaluate(() =>
    Object.assign(window, {
      cancelledImagePrint: '',
      derpDesktop: {
        printFrame: () => new Promise<void>(() => {}),
        cancelPrint: async (name: string) => {
          Object.assign(window, { cancelledImagePrint: name })
        },
      },
    }),
  )
  await page.getByRole('button', { name: 'Image actions' }).click()
  await page.getByRole('menuitem', { name: 'Print image' }).click()
  const dialog = page.getByRole('dialog', { name: 'Print image', exact: true })
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(page.locator('iframe[title="Image print document"]')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('iframe[title="Image print document"]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { cancelledImagePrint: string }).cancelledImagePrint,
      ),
    )
    .toMatch(/^derp-print-/)
  await page.getByRole('button', { name: 'Image actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Download image' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('browser printing uses the chosen paper and closes only after afterprint', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {
      window.top!.postMessage(
        {
          type: 'image-print-browser',
          css: document.querySelector('style')?.textContent,
          images: document.images.length,
        },
        '*',
      )
      window.dispatchEvent(new Event('afterprint'))
    }
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'image-print-browser')
        Object.assign(window, { printedImagePage: event.data })
    })
  })
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Print image', exact: true })
  await dialog.getByLabel('Paper', { exact: true }).selectOption('photo')
  await dialog.getByLabel('Orientation', { exact: true }).selectOption('portrait')
  await dialog.getByLabel('Margin (mm)').fill('0')
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { printedImagePage: unknown }).printedImagePage),
      ),
    )
    .toBe(true)
  const result = await page.evaluate(
    () =>
      (window as unknown as { printedImagePage: { css: string; images: number } }).printedImagePage,
  )
  expect(result.css).toContain('size:101.6mm 152.4mm')
  expect(result.images).toBe(1)
  await expect(page.locator('iframe[title="Image print document"]')).toHaveCount(0)
})

test('a broken original produces a recoverable print error without closing the image', async ({
  page,
}) => {
  await page.route('**/api/files/download?path=Images%2Fphoto.jpg', (route) =>
    route.fulfill({ status: 500, body: 'Unavailable' }),
  )
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Print image', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('Could not load the original image')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
})
