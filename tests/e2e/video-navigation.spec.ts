import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const source = 'Notes/navigation-chapters.mp4'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
test.beforeAll(() => {
  const metadata = path.join(root(), 'Notes/navigation.ffmetadata')
  fs.writeFileSync(
    metadata,
    ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4000\ntitle=Opening\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=4000\nEND=8000\ntitle=Вторая глава\n',
  )
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=10:duration=8',
    '-i',
    metadata,
    '-map_metadata',
    '1',
    '-map_chapters',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    path.join(root(), source),
  ])
  fs.rmSync(metadata)
})
test.afterAll(() => fs.rmSync(path.join(root(), source), { force: true }))
async function open(page: Page) {
  await page.goto(`/?dir=Notes&playing=${encodeURIComponent(source)}`)
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  const pause = page.getByRole('button', { name: 'Pause video', exact: true })
  if (await pause.isVisible()) await pause.click()
  return page.locator('video')
}
async function navigate(page: Page) {
  await page.getByRole('button', { name: 'Go to time', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Video navigation', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'Go to time', exact: true })).toBeFocused()
  return dialog
}
test('embedded chapters and precise jumps preserve pause state and validate time input', async ({
  page,
  request,
}) => {
  const video = await open(page)
  const info = await (
    await request.get(`/api/playback/info?path=${encodeURIComponent(source)}`)
  ).json()
  expect(info.chapters).toEqual([
    { start: 0, title: 'Opening' },
    { start: 4, title: 'Вторая глава' },
  ])
  let dialog = await navigate(page)
  await dialog.getByRole('textbox', { name: 'Go to time', exact: true }).fill('0:99')
  await dialog.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Enter a time between')
  await dialog.getByRole('textbox', { name: 'Go to time', exact: true }).fill('0:02.125')
  await dialog.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(2.125, 2)
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  dialog = await navigate(page)
  await dialog.getByRole('button', { name: /Вторая глава/ }).click()
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(4, 2)
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
})
test('A–B repeats on the actual media element and an explicit outside seek clears it', async ({
  page,
}) => {
  const video = await open(page)
  const dialog = await navigate(page)
  await dialog.getByRole('textbox', { name: 'Loop start' }).fill('1')
  await dialog.getByRole('textbox', { name: 'Loop end' }).fill('2')
  await dialog.getByRole('button', { name: 'Repeat A–B', exact: true }).click()
  await expect(dialog.getByText('A–B active', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Clear section repeat' })).toBeVisible()
  await page.getByRole('button', { name: 'Play video', exact: true }).click()
  await video.evaluate((element: HTMLVideoElement) => {
    const recorded: number[] = []
    Object.assign(window, { recordedLoopPositions: recorded })
    element.addEventListener('timeupdate', () => recorded.push(element.currentTime))
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const positions = (window as unknown as { recordedLoopPositions: number[] })
            .recordedLoopPositions
          return positions.some(
            (position, index) => index > 0 && positions[index - 1]! - position > 0.5,
          )
        }),
      { timeout: 8000 },
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Pause video', exact: true }).click()
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  const next = await navigate(page)
  await next.getByRole('textbox', { name: 'Go to time', exact: true }).fill('5')
  await next.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Clear section repeat' })).toHaveCount(0)
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(5, 2)
})
test('chapter and navigation shortcuts work without stealing text entry, including fullscreen and narrow screens', async ({
  page,
}) => {
  const video = await open(page)
  await video.focus()
  await page.keyboard.press('PageDown')
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(4, 2)
  await page.keyboard.press('g')
  const dialog = page.getByRole('dialog', { name: 'Video navigation', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Go to time', exact: true }).fill('3')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await navigate(page)
  expect(
    await dialog.evaluate((element) => {
      const r = element.getBoundingClientRect()
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
    }),
  ).toBe(true)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
  await page.getByRole('button', { name: 'Go to time', exact: true }).click()
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((element) => document.fullscreenElement?.contains(element))).toBe(
    true,
  )
})

test('repeat at the end of a file resumes at A, and keyboard markers clear without changing playback intent', async ({
  page,
}) => {
  const video = await open(page)
  let dialog = await navigate(page)
  await dialog.getByRole('textbox', { name: 'Loop start' }).fill('6.5')
  await dialog.getByRole('textbox', { name: 'Loop end' }).fill('8')
  await dialog.getByRole('button', { name: 'Repeat A–B', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Play video', exact: true }).click()
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 7.95
  })
  await expect
    .poll(
      () =>
        video.evaluate(
          (element: HTMLVideoElement) =>
            element.currentTime >= 6.5 && element.currentTime < 7.5 && !element.paused,
        ),
      { timeout: 5000 },
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Pause video', exact: true }).click()
  await page.getByRole('button', { name: 'Clear section repeat' }).click()
  await video.focus()
  await page.keyboard.press('Shift+l')
  await expect(page.getByRole('button', { name: 'Clear section repeat' })).toContainText('A…')
  dialog = await navigate(page)
  await dialog.getByRole('textbox', { name: 'Go to time', exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Go', exact: true }).click()
  await video.focus()
  await page.keyboard.press('Shift+l')
  await expect(page.getByRole('button', { name: 'Clear section repeat' })).toContainText('A–B')
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.keyboard.press('Shift+l')
  await expect(page.getByRole('button', { name: 'Clear section repeat' })).toHaveCount(0)
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
})
