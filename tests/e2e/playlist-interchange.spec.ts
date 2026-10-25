import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const root = () =>
  path.resolve(process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media')
const prefix = 'Interchange '
const unicode = 'Music/playlist-Вечер #1.mp3'
let outside = ''
test.beforeAll(() => {
  fs.copyFileSync(path.join(root(), 'Music/track.mp3'), path.join(root(), unicode))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-playlist-outside-'))
  fs.copyFileSync(path.join(root(), 'Music/track.mp3'), path.join(outside, 'outside.mp3'))
  fs.symlinkSync(path.join(outside, 'outside.mp3'), path.join(root(), 'Music/playlist-outside.mp3'))
})
test.afterEach(async ({ request }) => {
  const { items } = await (await request.get('/api/music/playlists')).json()
  for (const item of items)
    if (item.name.startsWith(prefix)) await request.delete(`/api/music/playlists/${item.id}`)
})
test.afterAll(() => {
  for (const file of [
    unicode,
    'Music/playlist-outside.mp3',
    'Notes/interchange-source.m3u8',
    'Notes/interchange-export.m3u8',
  ])
    fs.rmSync(path.join(root(), file), { force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})
async function open(page: Page) {
  await page.goto('/?dir=Music&playing=Music%2Ftrack.mp3')
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  return page.getByRole('dialog', { name: 'Playlists', exact: true })
}
async function upload(page: Page, content: string, name = 'source.m3u8') {
  const dialog = await open(page)
  await dialog.getByRole('button', { name: 'Import…', exact: true }).click()
  await dialog
    .getByLabel('Playlist file', { exact: true })
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
  return dialog
}
async function create(request: APIRequestContext, name: string) {
  const response = await request.post('/api/music/playlists', {
    data: { name, paths: ['Music/track.mp3', unicode] },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()).id as string
}
test('import previews exact local matches, removes duplicates and skips missing, external and escaping paths before creating anything', async ({
  page,
  request,
}) => {
  const content = `#EXTM3U\n#PLAYLIST:${prefix}review\nMusic/track.mp3\n${pathToFileURL(path.join(root(), unicode)).href}\nMusic/track.mp3\nMusic/missing.mp3\nhttps://outside.test/song.mp3\nMusic/playlist-outside.mp3\n${pathToFileURL(path.join(outside, 'outside.mp3')).href}\n`
  const dialog = await upload(page, content)
  await expect(dialog.getByRole('status')).toContainText(
    '2 songs found · 4 skipped · 1 duplicate removed',
  )
  expect(
    (await (await request.get('/api/music/playlists')).json()).items.some(
      (item: { name: string }) => item.name === `${prefix}review`,
    ),
  ).toBe(false)
  await dialog.getByText('Review skipped entries', { exact: true }).click()
  await expect(dialog.getByText('External streams are not imported', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Import 2 songs', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: `${prefix}review`, exact: true })).toBeVisible()
  const { items } = await (await request.get('/api/music/playlists')).json()
  const saved = await (
    await request.get(
      `/api/music/playlists/${items.find((item: { name: string }) => item.name === `${prefix}review`).id}`,
    )
  ).json()
  expect(saved.items.map((item: { path: string }) => item.path)).toEqual([
    'Music/track.mp3',
    unicode,
  ])
})
test('relative paths can be rebased with the folder picker and a library playlist opens with the correct parent folder', async ({
  page,
  request,
}) => {
  let dialog = await upload(page, '#EXTM3U\ntrack.mp3\n../MediaContent/track.mp3\n')
  await expect(dialog.getByRole('status')).toContainText('0 songs found')
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click()
  await dialog
    .getByRole('group', { name: 'Playlist base folder' })
    .getByRole('button', { name: 'Music', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Check files', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('2 songs found · 0 skipped')
  await dialog.getByRole('textbox', { name: 'Playlist name' }).fill(`${prefix}rebased`)
  await dialog.getByRole('button', { name: 'Import 2 songs', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: `${prefix}rebased` })).toBeVisible()
  expect(
    (
      await request.post('/api/files/create', {
        data: {
          path: 'Notes/interchange-source.m3u8',
          content: `#EXTM3U\n#PLAYLIST:${prefix}from file\n../Music/track.mp3\n`,
        },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/?dir=Notes&viewing=Notes%2Finterchange-source.m3u8')
  await page.getByRole('button', { name: 'Import playlist…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Playlists', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'Folder for relative paths' })).toHaveValue(
    'Notes',
  )
  await expect(dialog.getByRole('status')).toContainText('1 song found · 0 skipped')
  await dialog.getByRole('button', { name: 'Import 1 song', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: `${prefix}from file` })).toBeVisible()
})
test('exports downloadable server URLs and local file URLs, saves a copy and imports the server export again', async ({
  page,
  request,
}) => {
  await create(request, `${prefix}export`)
  const dialog = await open(page)
  await dialog.getByRole('button', { name: new RegExp(`${prefix}export`) }).click()
  await dialog.getByRole('button', { name: 'Export…', exact: true }).click()
  const exportDialog = page.getByRole('dialog', { name: 'Export playlist', exact: true })
  const downloading = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  const download = await downloading
  const text = fs.readFileSync((await download.path())!, 'utf8')
  expect(download.suggestedFilename()).toBe(`${prefix}export.m3u8`)
  expect(text).toContain('/api/media/Music/track.mp3')
  expect(text).toContain(encodeURIComponent('playlist-Вечер #1.mp3'))
  await dialog.getByRole('button', { name: 'Export…', exact: true }).click()
  await exportDialog.getByRole('combobox', { name: 'Export format' }).selectOption('local')
  const localDownloading = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  const local = fs.readFileSync((await (await localDownloading).path())!, 'utf8')
  expect(local).toContain(pathToFileURL(path.join(root(), unicode)).href)
  await dialog.getByRole('button', { name: 'Export…', exact: true }).click()
  await exportDialog
    .getByRole('textbox', { name: 'File name', exact: true })
    .fill('interchange-export.m3u8')
  await exportDialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(exportDialog).toBeHidden()
  expect(fs.readFileSync(path.join(root(), 'Notes/interchange-export.m3u8'), 'utf8')).toBe(text)
  await dialog.getByRole('button', { name: 'Back to playlists' }).click()
  await dialog.getByRole('button', { name: 'Import…', exact: true }).click()
  await dialog
    .getByLabel('Playlist file', { exact: true })
    .setInputFiles({ name: 'roundtrip.m3u8', mimeType: 'text/plain', buffer: Buffer.from(text) })
  await expect(dialog.getByRole('status')).toContainText('2 songs found · 0 skipped')
})
test('XSPF and PLS are recognized, malformed XML and HLS fail visibly, and import fits a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const file = pathToFileURL(path.join(root(), unicode)).href
  const dialog = await upload(
    page,
    `<?xml version="1.0"?><playlist xmlns="http://xspf.org/ns/0/" version="1"><title>${prefix}XSPF</title><trackList><track><location>${file}</location></track></trackList></playlist>`,
    'vlc.xspf',
  )
  await expect(dialog.getByRole('status')).toContainText('1 song found · 0 skipped')
  expect(
    await dialog.evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
  ).toBe(true)
  await dialog
    .getByLabel('Playlist file', { exact: true })
    .setInputFiles({
      name: 'old.pls',
      mimeType: 'text/plain',
      buffer: Buffer.from('[playlist]\nFile1=Music/track.mp3\nFile2=MediaContent/track.mp3\n'),
    })
  await expect(dialog.getByRole('status')).toContainText('2 songs found · 0 skipped')
  await dialog
    .getByLabel('Playlist file', { exact: true })
    .setInputFiles({
      name: 'bad.xspf',
      mimeType: 'text/plain',
      buffer: Buffer.from('<!DOCTYPE playlist><playlist/>'),
    })
  await expect(dialog.getByRole('alert')).toContainText('document types or entities')
  await dialog
    .getByLabel('Playlist file', { exact: true })
    .setInputFiles({
      name: 'stream.m3u8',
      mimeType: 'text/plain',
      buffer: Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:6\npart.ts\n'),
    })
  await expect(dialog.getByRole('alert')).toContainText('HLS streaming manifest')
  await expect(dialog.getByRole('button', { name: 'Import playlist', exact: true })).toBeDisabled()
})
