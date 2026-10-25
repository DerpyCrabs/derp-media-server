import { test, expect, type Page } from '@playwright/test'

const controls = (page: Page) => page.getByRole('group', { name: 'Slideshow controls' })
const path = (page: Page) => new URL(page.url()).searchParams.get('viewing')
async function open(page: Page) {
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.clock.install()
}
async function start(page: Page) {
  await page.getByRole('button', { name: 'Image actions', exact: true }).click()
  await page.getByRole('menuitem', { name: /Start slideshow/ }).click()
  await controls(page).getByRole('combobox', { name: 'Slideshow interval' }).selectOption('2')
}

test('slideshow advances, stops at the last image, and replays without changing the folder order', async ({
  page,
}) => {
  await open(page)
  await start(page)
  await page.clock.fastForward(2100)
  await expect.poll(() => path(page)).toBe('Images/photo.png')
  await expect(page.getByRole('img', { name: 'photo.png', exact: true })).toBeVisible()
  await page.clock.fastForward(2100)
  await expect(controls(page).getByRole('button', { name: 'Replay slideshow' })).toBeVisible()
  await controls(page).getByRole('button', { name: 'Replay slideshow' }).click()
  await expect.poll(() => path(page)).toBe('Images/photo.jpg')
  await page.keyboard.press('Escape')
  await expect(controls(page)).toBeHidden()
  await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
  await page.clock.fastForward(10000)
  expect(path(page)).toBe('Images/photo.jpg')
})

test('loop, pause and background suspension preserve a full viewing interval', async ({ page }) => {
  await open(page)
  await start(page)
  await controls(page).getByRole('checkbox', { name: 'Loop' }).check()
  await page.clock.fastForward(2100)
  await expect.poll(() => path(page)).toBe('Images/photo.png')
  await expect(page.getByRole('img', { name: 'photo.png', exact: true })).toBeVisible()
  await page.clock.fastForward(2100)
  await expect.poll(() => path(page)).toBe('Images/photo.jpg')
  await controls(page).getByRole('button', { name: 'Pause slideshow' }).click()
  await page.clock.fastForward(10000)
  expect(path(page)).toBe('Images/photo.jpg')
  await controls(page).getByRole('button', { name: 'Resume slideshow' }).click()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(10000)
  expect(path(page)).toBe('Images/photo.jpg')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(1500)
  expect(path(page)).toBe('Images/photo.jpg')
  await page.clock.fastForward(600)
  await expect.poll(() => path(page)).toBe('Images/photo.png')
})

test('zoom pauses slideshow and arrow keys pan while PageDown still selects the next file', async ({
  page,
}) => {
  await page.route('**/api/media/Images/photo.jpg*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800"><rect width="2400" height="1800" fill="orange"/></svg>',
    }),
  )
  await open(page)
  await start(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(controls(page).getByRole('button', { name: 'Resume slideshow' })).toBeVisible()
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

test('a failed image pauses instead of skipping past the error', async ({ page }) => {
  await page.route(/\/api\/(?:media|image)\/Images\/photo\.png/, (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  )
  await open(page)
  await start(page)
  await page.clock.fastForward(2100)
  await expect.poll(() => path(page)).toBe('Images/photo.png')
  await expect(page.getByRole('status')).toContainText(
    'Slideshow paused: this image could not be loaded.',
  )
  await expect(controls(page).getByRole('button', { name: 'Resume slideshow' })).toBeVisible()
  await page.clock.fastForward(10000)
  expect(path(page)).toBe('Images/photo.png')
})

test('the interval begins after a slow image finishes loading', async ({ page }) => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/api\/(?:media|image)\/Images\/photo\.png/, async (route) => {
    await ready
    await route.continue()
  })
  try {
    await open(page)
    await start(page)
    await page.clock.fastForward(2100)
    await expect.poll(() => path(page)).toBe('Images/photo.png')
    await page.clock.fastForward(10000)
    await expect(controls(page).getByRole('button', { name: 'Pause slideshow' })).toBeVisible()
    release()
    await expect(page.getByRole('img', { name: 'photo.png', exact: true })).toHaveAttribute(
      'src',
      /photo.png/,
    )
    await page.clock.fastForward(1500)
    await expect(controls(page).getByRole('button', { name: 'Pause slideshow' })).toBeVisible()
    await page.clock.fastForward(600)
    await expect(controls(page).getByRole('button', { name: 'Replay slideshow' })).toBeVisible()
  } finally {
    release()
  }
})
