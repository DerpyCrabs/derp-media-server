import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
const names = ['ogg-profile.ogg', 'ogg-profile.oga', 'ogg-profile.ogv']
test.beforeAll(() => {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4',
    '-c:a',
    'libvorbis',
    '-y',
    path.join(root(), 'Music', names[0]!),
  ])
  fs.copyFileSync(path.join(root(), 'Music', names[0]!), path.join(root(), 'Music', names[1]!))
  fs.writeFileSync(path.join(root(), 'Music', names[2]!), 'OggS')
})
test.afterAll(() => {
  for (const name of names) fs.rmSync(path.join(root(), 'Music', name), { force: true })
})

test('Ogg tracks open in the native audio view, use the audio MIME type and enter playlists', async ({
  page,
  request,
}) => {
  const audio = await request.get('/api/media/Music/ogg-profile.ogg')
  expect(audio.headers()['content-type']).toContain('audio/ogg')
  expect(
    (await request.get('/api/media/Music/ogg-profile.oga')).headers()['content-type'],
  ).toContain('audio/ogg')
  expect(
    (await request.get('/api/media/Music/ogg-profile.ogv')).headers()['content-type'],
  ).toContain('video/ogg')
  await page.addInitScript(() =>
    Object.assign(window, {
      derpDesktop: {
        ready: async () => {},
        onOpen: () => () => {},
        onBeforeClose: () => () => {},
        close: () => {},
      },
    }),
  )
  await page.goto('/desktop?mode=viewer&dir=Music&viewing=Music%2Fogg-profile.ogg')
  await expect(page.getByTestId('canvas-audio-player-ui')).toBeVisible()
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration))
    .toBeGreaterThan(3.9)
  await page
    .getByRole('button', { name: 'Pause', exact: true })
    .or(page.getByRole('button', { name: 'Play', exact: true }))
    .waitFor()
  const paths = ['Music/ogg-profile.ogg', 'Music/ogg-profile.oga']
  const created = await request.post('/api/music/playlists', {
    data: { name: 'Ogg profile check', paths: paths },
  })
  expect(created.ok()).toBe(true)
  const { id } = await created.json()
  try {
    const playlist = await (await request.get(`/api/music/playlists/${id}`)).json()
    expect(playlist.items.map((item: { path: string }) => item.path)).toEqual(paths)
  } finally {
    await request.delete(`/api/music/playlists/${id}`)
  }
})
