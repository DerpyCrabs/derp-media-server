import { expect, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const videos = [
  { id: 101, path: 'MediaContent/ForYouTestMedia/first.mp4', name: 'First clip', type: 'video' },
  { id: 102, path: 'MediaContent/ForYouTestMedia/second.webm', name: 'Second clip', type: 'video' },
]
export const tracks = [
  { id: 201, path: 'Music/track.mp3', name: 'First song', type: 'audio' },
  { id: 202, path: 'MediaContent/track.mp3', name: 'Second song', type: 'audio' },
]
export const videoFolder = {
  id: -101,
  path: 'MediaContent/ForYouTestMedia',
  name: 'Video collection',
  type: 'folder',
  isDirectory: true,
  itemCount: 2,
  previewPath: videos[0].path,
  members: videos,
}
export function homePage(items: object[], nextCursor: number | null = null) {
  return { generatedAt: 1, nextCursor, rows: [{ title: 'For you', items }] }
}
export async function enableForYou(page: Page, items: object[] = [...videos, ...tracks]) {
  await page.route('**/api/media-ai/status', (route) => route.fulfill({ json: { enabled: true } }))
  await page.route('**/api/media-ai/home*', (route) => route.fulfill({ json: homePage(items) }))
}
export async function readyVideo(page: Page) {
  const video = page.locator('video')
  await expect(video).toBeVisible()
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2)
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true
  })
  return video
}
export async function advancing(video: Locator) {
  const initial = await video.evaluate((v: HTMLMediaElement) => v.currentTime)
  await expect
    .poll(() => video.evaluate((v: HTMLMediaElement) => v.currentTime))
    .toBeGreaterThan(initial + 0.2)
  await expect.poll(() => video.evaluate((v: HTMLMediaElement) => v.paused)).toBe(false)
}
export async function playNative(video: Locator) {
  await video.evaluate((v: HTMLMediaElement) => v.play())
  await advancing(video)
}
export async function pauseAt(video: Locator, position: number) {
  await video.evaluate(async (v: HTMLMediaElement) => {
    if (v.paused) return
    await new Promise<void>((resolve) => {
      v.addEventListener('pause', () => resolve(), { once: true })
      v.pause()
    })
  })
  await expect.poll(() => video.evaluate((v: HTMLMediaElement) => v.paused)).toBe(true)
  await video.evaluate((v: HTMLMediaElement, time) => {
    v.currentTime = time
  }, position)
  await expect.poll(() => video.evaluate((v: HTMLMediaElement) => v.seeking)).toBe(false)
  await expect
    .poll(() => video.evaluate((v: HTMLMediaElement) => v.currentTime))
    .toBeCloseTo(position, 1)
}
export async function openSearch(page: Page) {
  await page
    .getByTestId('media-navigation-header')
    .getByRole('button', { name: 'Search library', exact: true })
    .click()
  return page.getByRole('textbox', { name: 'Search your library' })
}
export async function optionsFor(page: Page, name: string) {
  await page.getByRole('button', { name: `Options for ${name}`, exact: true }).click()
  return page.getByRole('menu')
}

const fixturePath = path.resolve(
  process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media',
  'MediaContent',
  'ForYouTestMedia',
)
export function setupForYouMedia() {
  fs.mkdirSync(fixturePath, { recursive: true })
  for (const [file, videoCodec, audioCodec] of [
    ['first.mp4', 'libx264', 'aac'],
    ['second.webm', 'libvpx', 'libvorbis'],
  ]) {
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=navy:s=320x180:d=12',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono',
        '-shortest',
        '-c:v',
        videoCodec,
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        audioCodec,
        path.join(fixturePath, file),
      ],
      { stdio: 'pipe' },
    )
  }
}
export function cleanupForYouMedia() {
  fs.rmSync(fixturePath, { recursive: true, force: true })
}
