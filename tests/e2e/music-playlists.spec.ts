import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const paths = ['Music/track.mp3', 'MediaContent/track.mp3', 'Music/track.flac']
let ids: string[] = []
test.beforeEach(() => {
  ids = []
})
test.afterEach(async ({ request }) => {
  for (const id of ids) await request.delete(`/api/music/playlists/${id}`)
})
async function create(request: APIRequestContext, name: string, selected = paths) {
  const response = await request.post('/api/music/playlists', { data: { name, paths: selected } })
  expect(response.ok(), await response.text()).toBe(true)
  const { id } = await response.json()
  ids.push(id)
  return id as string
}
async function open(page: Page) {
  await page.goto('/?dir=Music&playing=Music%2Ftrack.mp3')
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  return page.getByRole('dialog', { name: 'Playlists', exact: true })
}
test('saved folder songs remain visible without a music index and can be reordered, renamed and removed', async ({
  page,
  request,
}) => {
  const id = await create(request, 'Folder favourites')
  const dialog = await open(page)
  await dialog.getByRole('button', { name: /Folder favourites/ }).click()
  const songs = dialog.getByRole('list', { name: 'Folder favourites' })
  await expect(songs.getByRole('listitem')).toHaveCount(3)
  await songs
    .getByRole('listitem')
    .nth(1)
    .getByRole('button', { name: /^Music options for / })
    .click()
  await page.getByRole('menuitem', { name: 'Move up', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await request.get(`/api/music/playlists/${id}`).then((r) => r.json())).items[0].path,
    )
    .toBe(paths[1])
  await dialog.getByRole('button', { name: 'Playlist options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit playlist', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Evening music')
  await dialog.getByRole('button', { name: 'Save playlist', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Evening music' })).toBeVisible()
  await dialog
    .getByRole('listitem')
    .nth(2)
    .getByRole('button', { name: /^Music options for / })
    .click()
  await page.getByRole('menuitem', { name: 'Remove from playlist', exact: true }).click()
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
  const saved = await request.get(`/api/music/playlists/${id}`).then((r) => r.json())
  expect(saved.name).toBe('Evening music')
  expect(saved.items.map((track: { path: string }) => track.path)).toEqual([paths[1], paths[0]])
  await page.reload()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await dialog.getByRole('button', { name: /Evening music/ }).click()
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Playlist options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete playlist', exact: true }).click()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await request.get(`/api/music/playlists/${id}`)).ok()).toBe(true)
  await dialog.getByRole('button', { name: 'Playlist options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete playlist', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete playlist', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Playlists', exact: true })).toBeVisible()
  expect((await request.get(`/api/music/playlists/${id}`)).status()).toBe(404)
  expect((await request.get('/api/files?path=Music')).ok()).toBe(true)
})
test('an edit from another tab cannot overwrite newer playlist contents', async ({
  page,
  request,
}) => {
  const id = await create(request, 'Two windows', [paths[0]!])
  const dialog = await open(page)
  await dialog.getByRole('button', { name: /Two windows/ }).click()
  await dialog.getByRole('button', { name: 'Playlist options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit playlist', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Stale rename')
  expect(
    (await request.post(`/api/music/playlists/${id}/tracks`, { data: { paths: [paths[1]] } })).ok(),
  ).toBe(true)
  await dialog.getByRole('button', { name: 'Save playlist', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('changed in another window')
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Stale rename',
  )
  const saved = await request.get(`/api/music/playlists/${id}`).then((r) => r.json())
  expect(saved.name).toBe('Two windows')
  expect(saved.items).toHaveLength(2)
  await dialog.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
})
test('new saved playlists can be created with a keyboard', async ({ page, request }) => {
  const dialog = await open(page)
  await dialog.getByRole('button', { name: 'New playlist', exact: true }).click()
  const name = `Quiet ${Date.now()}`
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`${name} manual`)
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).press('Enter')
  await expect(dialog.getByRole('heading', { name: `${name} manual`, exact: true })).toBeVisible()
  const manual = (await request.get('/api/music/playlists').then((r) => r.json())).items.find(
    (item: { name: string }) => item.name === `${name} manual`,
  )
  ids.push(manual.id)
  expect(manual.rules).toBe(null)
  await dialog.getByRole('button', { name: 'Add songs', exact: true }).click()
  await expect(dialog.getByRole('searchbox', { name: 'Search songs' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('heading', { name: `${name} manual`, exact: true })).toBeVisible()
})

test('the complete folder queue can be saved and appended without duplicates', async ({
  page,
  request,
}) => {
  await page.goto('/?dir=Music&playing=Music%2Ftrack.mp3')
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Save queue…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Playlists', exact: true })
  await dialog.getByRole('button', { name: 'New playlist', exact: true }).click()
  const name = `Saved queue ${Date.now()}`
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Save playlist', exact: true }).click()
  await expect(dialog).toBeHidden()
  const saved = (await request.get('/api/music/playlists').then((r) => r.json())).items.find(
    (item: { name: string }) => item.name === name,
  )
  ids.push(saved.id)
  const read = () => request.get(`/api/music/playlists/${saved.id}`).then((r) => r.json())
  expect((await read()).items.map((track: { path: string }) => track.path)).toEqual([
    'Music/track.flac',
    'Music/track.mp3',
  ])
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Save queue…', exact: true }).click()
  await dialog.getByRole('button', { name: new RegExp(name) }).click()
  await expect(dialog).toBeHidden()
  expect((await read()).items).toHaveLength(2)
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await dialog.getByRole('button', { name: new RegExp(name) }).click()
  await dialog.getByRole('button', { name: 'Play all', exact: true }).click()
  await expect(page).toHaveURL(/playing=Music%2Ftrack.flac/)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  const queue = page.getByRole('dialog', { name: 'Up next', exact: true })
  await expect(queue).toContainText(name)
  await expect(queue.getByRole('listitem')).toHaveCount(2)
})

test('song options append to another playlist and search selections persist across results', async ({
  page,
  request,
}) => {
  const source = await create(request, 'Source songs', [paths[0]!])
  const target = await create(request, 'Destination songs', [])
  const dialog = await open(page)
  await dialog.getByRole('button', { name: /Source songs/ }).click()
  await dialog
    .getByRole('button', { name: /^Music options for / })
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'Add to playlist…', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Add to playlist' })).toBeVisible()
  await dialog.getByRole('button', { name: /Destination songs/ }).click()
  await expect(dialog).toBeHidden()
  expect(
    (await request.get(`/api/music/playlists/${target}`).then((r) => r.json())).items,
  ).toHaveLength(1)
  const track = (await request.get(`/api/music/playlists/${source}`).then((r) => r.json())).items[0]
  const second = { ...track, path: paths[1], title: 'Another song' }
  await page.route('**/api/music/tracks?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q')
    return route.fulfill({ json: { items: q ? [second] : [track, second], total: q ? 1 : 2 } })
  })
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await dialog.getByRole('button', { name: /Destination songs/ }).click()
  await dialog.getByRole('button', { name: 'Add songs', exact: true }).click()
  await expect(dialog.getByRole('checkbox').first()).toBeDisabled()
  await dialog.getByRole('checkbox').nth(1).check()
  await dialog.getByRole('searchbox').fill('Another')
  await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await dialog.getByRole('button', { name: 'Add 1 songs', exact: true }).click()
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
  expect(
    (await request.get(`/api/music/playlists/${target}`).then((r) => r.json())).items.map(
      (item: { path: string }) => item.path,
    ),
  ).toEqual(paths.slice(0, 2))
})

test('missing unindexed songs stay visible and do not prevent renaming or removing the entry', async ({
  page,
  request,
}) => {
  const root = path.resolve(
    process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media',
  )
  const logical = `Notes/playlist-missing-${Date.now()}.mp3`
  const local = path.join(root, logical)
  fs.copyFileSync(path.join(root, 'Music/track.mp3'), local)
  try {
    const id = await create(request, 'Missing song', [logical])
    fs.unlinkSync(local)
    const before = await request.get(`/api/music/playlists/${id}`).then((r) => r.json())
    expect(before.items).toHaveLength(1)
    expect(before.items[0].available).toBe(false)
    const dialog = await open(page)
    await dialog.getByRole('button', { name: /Missing song/ }).click()
    await expect(dialog.getByRole('button', { name: /^Play music / })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Play all', exact: true })).toBeDisabled()
    await expect(dialog).toContainText('Unavailable')
    await dialog.getByRole('button', { name: 'Playlist options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit playlist', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Waiting for drive')
    await dialog.getByRole('button', { name: 'Save playlist', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Waiting for drive' })).toBeVisible()
    await dialog.getByRole('button', { name: /^Music options for / }).click()
    await expect(page.getByRole('menuitem', { name: 'Play next', exact: true })).toBeDisabled()
    await page.getByRole('menuitem', { name: 'Remove from playlist', exact: true }).click()
    await expect(dialog).toContainText('This playlist is empty')
    expect(
      (await request.get(`/api/music/playlists/${id}`).then((r) => r.json())).items,
    ).toHaveLength(0)
  } finally {
    fs.rmSync(local, { force: true })
  }
})
