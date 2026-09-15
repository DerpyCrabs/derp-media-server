import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const mediaRoot = process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media'
const folder = `Warmup-${process.env.BATCH_ID ?? 'local'}`
const fileName = (index: number) => `image-${String(index).padStart(3, '0')}.png`

test.beforeAll(() => {
  fs.mkdirSync(path.resolve(mediaRoot, folder), { recursive: true })
  for (let index = 0; index < 130; index++) {
    fs.copyFileSync(
      path.resolve(mediaRoot, 'Images/photo.png'),
      path.resolve(mediaRoot, folder, fileName(index)),
    )
  }
})

test.afterAll(() => {
  fs.rmSync(path.resolve(mediaRoot, folder), { recursive: true, force: true })
})

test('viewer warms thirty ahead but only downloads the nearest two', async ({ page }) => {
  const warmed = new Set<string>()
  const downloaded = new Set<string>()
  await page.route('**/api/warm/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/warm/image/')) {
      expect(route.request().method()).toBe('POST')
      expect(url.searchParams.get('scale')).toBe('1')
      warmed.add(url.pathname.split('/').pop()!)
    }
    await route.fulfill({ body: 'done' })
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/image/') && url.searchParams.get('priority') !== 'active') {
      downloaded.add(url.pathname.split('/').pop()!)
    }
  })
  await page.goto(`/?dir=${folder}&viewing=${folder}/${fileName(0)}`)
  await expect.poll(() => warmed.size).toBe(28)
  expect([...warmed]).toEqual(Array.from({ length: 28 }, (_, index) => fileName(index + 3)))
  expect([...downloaded].sort()).toEqual([fileName(1), fileName(2)])
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => warmed.has(fileName(31))).toBe(true)
  expect(warmed.has(fileName(32))).toBe(false)
})

test('warms thumbnails beyond mounted rows without downloading them', async ({ page }) => {
  const warmed = new Set<string>()
  const downloaded = new Set<string>()
  await page.route('**/api/warm/thumbnail/**', async (route) => {
    warmed.add(new URL(route.request().url()).pathname.split('/').pop()!)
    await route.fulfill({ body: 'done' })
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/thumbnail/')) downloaded.add(url.pathname.split('/').pop()!)
  })
  await page.goto(`/?dir=${folder}`)
  await expect.poll(() => warmed.has(fileName(129))).toBe(true)
  await expect(page.locator(`[data-file-path="${folder}/${fileName(129)}"]`)).toHaveCount(0)
  expect(downloaded.has(fileName(129))).toBe(false)
})

test('hidden tabs pause the remaining warmup and resume when visible', async ({ page }) => {
  let started = 0
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/warm/image/**', async (route) => {
    started++
    if (started === 1) await held
    await route.fulfill({ body: 'done' }).catch(() => undefined)
  })
  await page.route('**/api/warm/thumbnail/**', (route) => route.fulfill({ body: 'done' }))
  await page.goto(`/?dir=${folder}&viewing=${folder}/${fileName(0)}`)
  await expect.poll(() => started).toBe(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  release!()
  await page.waitForTimeout(400)
  expect(started).toBe(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => started).toBeGreaterThan(1)
})

test('warm endpoints return acknowledgements without transferring source files', async ({
  request,
}) => {
  const thumbnail = await request.post(`/api/warm/thumbnail/${folder}/${fileName(0)}`)
  expect(thumbnail.ok()).toBe(true)
  expect(await thumbnail.text()).toBe('done')
  const image = await request.post(
    `/api/warm/image/${folder}/${fileName(0)}?width=640&height=480&dpr=1&scale=1&priority=prefetch`,
  )
  expect(image.ok()).toBe(true)
  expect(await image.text()).toBe('done')
  expect(image.headers()['cache-control']).toBe('no-store')
})

test('leaving a directory discards its remaining thumbnail warmup', async ({ page }) => {
  let started = 0
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/warm/thumbnail/${folder}/**`, async (route) => {
    started++
    if (started === 1) await held
    await route.fulfill({ body: 'done' }).catch(() => undefined)
  })
  await page.goto(`/?dir=${folder}`)
  await expect.poll(() => started).toBe(1)
  await page.getByText('..', { exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`dir=${folder}`))
  release!()
  await page.waitForTimeout(400)
  expect(started).toBe(1)
})

test('closing the viewer discards remaining image warmup', async ({ page }) => {
  let started = 0
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/warm/image/**', async (route) => {
    started++
    if (started === 1) await held
    await route.fulfill({ body: 'done' }).catch(() => undefined)
  })
  await page.route('**/api/warm/thumbnail/**', (route) => route.fulfill({ body: 'done' }))
  await page.goto(`/?dir=${folder}&viewing=${folder}/${fileName(0)}`)
  await expect.poll(() => started).toBe(1)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page).not.toHaveURL(/viewing=/)
  release!()
  await page.waitForTimeout(400)
  expect(started).toBe(1)
})
