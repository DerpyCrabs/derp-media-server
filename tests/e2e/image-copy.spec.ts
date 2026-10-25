import { expect, test } from '@playwright/test'

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
