import { test, expect, type Page } from '@playwright/test'

const path = (page: Page) => new URL(page.url()).searchParams.get('viewing')
async function open(page: Page) {
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.clock.install()
}
test('arrow keys pan a zoomed image while PageDown selects the next file', async ({ page }) => {
  await page.route('**/api/media/Images/photo.jpg*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800"><rect width="2400" height="1800" fill="orange"/></svg>',
    }),
  )
  await open(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const surface = page.getByTestId('image-gesture-surface')
  await expect.poll(() => surface.evaluate((el) => el.scrollWidth)).toBeGreaterThan(2000)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => surface.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(() => surface.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(path(page)).toBe('Images/photo.jpg')
  await page.clock.fastForward(10000)
  expect(path(page)).toBe('Images/photo.jpg')
  await page.keyboard.press('PageDown')
  await expect.poll(() => path(page)).toBe('Images/photo.png')
})
