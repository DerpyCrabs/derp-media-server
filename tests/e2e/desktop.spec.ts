import { test, expect } from '@playwright/test'
import { mkdtemp, symlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('desktop path resolution maps library files and rejects traversal and escaping symlinks', async ({
  request,
}) => {
  const root = await request.post('/api/desktop/resolve', { data: { path: '' } })
  expect(root.ok()).toBeTruthy()
  const rootInfo = (await root.json()) as { absolutePath: string }
  const directory = await mkdtemp(path.join(tmpdir(), 'derp-outside-'))
  const link = path.join(rootInfo.absolutePath, `desktop-escape-${Date.now()}`)
  try {
    const outside = path.join(directory, 'outside.txt')
    await writeFile(outside, 'outside')
    await symlink(directory, link)
    const mapped = await request.post('/api/desktop/resolve', {
      data: { path: path.join(rootInfo.absolutePath, 'Notes'), absolute: true },
    })
    expect(await mapped.json()).toMatchObject({ path: 'Notes', isDirectory: true })
    for (const data of [
      { path: outside, absolute: true },
      { path: path.join(link, 'outside.txt'), absolute: true },
      { path: `${path.basename(link)}/outside.txt` },
      { path: '../outside.txt' },
    ])
      expect((await request.post('/api/desktop/resolve', { data })).ok()).toBeFalsy()
  } finally {
    await rm(link, { force: true })
    await rm(directory, { recursive: true, force: true })
  }
})

test('desktop folder navigation stays in its window and context menu requests new windows', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const calls: unknown[] = []
    Object.assign(window, {
      desktopCalls: calls,
      derpDesktop: {
        ready: async () => {},
        onBeforeClose: () => () => {},
        onOpen: () => () => {},
        open: async (path: string, reader?: boolean) => {
          calls.push({ path, reader })
        },
        openRoot: async () => {},
        copy: async () => {},
        drag: async () => {},
        paste: async () => 0,
        places: async () => [
          { name: 'Library', path: '' },
          { name: 'Notes', path: 'Notes' },
        ],
        hasFileClipboard: async () => false,
        importDrop: async () => 0,
        openDrop: async () => {},
        close: () => {},
      },
    })
  })
  await page.goto('/desktop?mode=browser&dir=')
  const notes = page.locator('table tr').filter({ hasText: 'Notes' }).first()
  await notes.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in new window', exact: true }).click()
  expect(
    await page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls),
  ).toEqual([{ path: 'Notes', reader: false }])
  await notes.click()
  await expect(page).toHaveURL(/dir=Notes/)
  expect(
    await page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls),
  ).toHaveLength(1)
  const paste = page.getByRole('button', { name: 'Paste files' })
  await expect(paste).toBeEnabled()
  await expect(paste).toHaveText('')
  await expect(paste).toHaveCSS('width', '28px')
  const row = page
    .locator('tr[data-file-path]')
    .filter({ has: page.locator('[data-column="size"]') })
    .first()
  const nameWidths: number[] = []
  for (const width of [900, 1600]) {
    await page.setViewportSize({ width, height: 900 })
    await expect
      .poll(async () =>
        row.evaluate((element) => {
          const size = element.querySelector('[data-column="size"]')!
          return Math.abs(
            element.getBoundingClientRect().right - size.getBoundingClientRect().right,
          )
        }),
      )
      .toBeLessThan(2)
    nameWidths.push(
      await row
        .locator('td')
        .nth(1)
        .evaluate((element) => element.getBoundingClientRect().width),
    )
  }
  expect(nameWidths[1]! - nameWidths[0]!).toBeGreaterThan(650)
  await page.screenshot({ path: testInfo.outputPath('desktop-browser.png') })
  await page
    .getByRole('navigation', { name: 'Places' })
    .getByRole('button', { name: 'Library', exact: true })
    .click()
  await expect(page.locator('table').getByText('Notes', { exact: true })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Places' })
    .getByRole('button', { name: 'Notes', exact: true })
    .click()
  await expect(page).toHaveURL(/dir=Notes/)
})

test('create-only native imports cannot overwrite existing files', async ({ request }) => {
  const filename = `desktop-import-${Date.now()}.txt`
  const upload = (buffer: string) =>
    request.post('/api/files/upload?create_only=true', {
      multipart: {
        targetDir: 'Notes',
        files: { name: filename, mimeType: 'text/plain', buffer: Buffer.from(buffer) },
      },
    })
  try {
    expect((await upload('original')).ok()).toBeTruthy()
    expect((await upload('replacement')).status()).toBe(409)
    const response = await request.get(
      `/api/files/download?path=${encodeURIComponent('Notes/' + filename)}`,
    )
    expect(await response.text()).toBe('original')
  } finally {
    await request.post('/api/files/delete', { data: { path: 'Notes/' + filename } })
  }
})

test.describe('system file associations', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = []
      Object.assign(window, {
        defaultAppCalls: calls,
        failDefaultApp: false,
        derpDesktop: {
          ready: async () => {},
          onBeforeClose: () => () => {},
          onOpen: () => () => {},
          openDefault: async (path: string) => {
            if ((window as unknown as { failDefaultApp: boolean }).failDefaultApp)
              throw new Error('No application is associated with this file')
            calls.push(path)
          },
          open: async () => {},
          openRoot: async () => {},
          copy: async () => {},
          drag: async () => {},
          paste: async () => 0,
          places: async () => [],
          hasFileClipboard: async () => false,
          importDrop: async () => 0,
          openDrop: async () => {},
          close: () => {},
        },
      })
      HTMLMediaElement.prototype.play = function () {
        this.muted = true
        return Promise.resolve()
      }
    })
  })

  test('opens folders and HTML files without changing the Derp view', async ({ page, request }) => {
    const file = 'open default # пример.html'
    const filePath = `Notes/${file}`
    await request.post('/api/files/upload?create_only=true', {
      multipart: {
        targetDir: 'Notes',
        files: { name: file, mimeType: 'text/html', buffer: Buffer.from('<h1>Local HTML</h1>') },
      },
    })
    try {
      await page.goto('/desktop?mode=browser&dir=')
      await page.locator('table tr').filter({ hasText: 'Notes' }).first().click({ button: 'right' })
      if (await page.getByRole('menuitem', { name: 'Open with...', exact: true }).isVisible())
        await page.getByRole('menuitem', { name: 'Open with...', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Open in default app', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { defaultAppCalls: string[] }).defaultAppCalls),
        )
        .toEqual(['Notes'])
      await expect(page).toHaveURL(/mode=browser&dir=$/)
      await page.goto('/desktop?mode=browser&dir=Notes')
      await page.locator('tr[data-file-path]').filter({ hasText: file }).click({ button: 'right' })
      if (await page.getByRole('menuitem', { name: 'Open with...', exact: true }).isVisible())
        await page.getByRole('menuitem', { name: 'Open with...', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Open in default app', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { defaultAppCalls: string[] }).defaultAppCalls),
        )
        .toEqual([filePath])
      await expect(page).toHaveURL(/dir=Notes/)
    } finally {
      await request.post('/api/files/delete', { data: { path: filePath } })
    }
  })

  for (const [path, menu] of [
    ['Notes/welcome.md', 'Document actions'],
    ['Images/photo.png', 'Image actions'],
    ['Music/track.mp3', 'Playback options'],
    ['Videos/sample.mp4', 'Playback settings'],
    ['Documents/reader.pdf', 'Reader settings'],
    ['Documents/reader.epub', 'Reader settings'],
  ]) {
    test(`opens the original from ${path}`, async ({ page }, testInfo) => {
      await page.goto(`/desktop?mode=viewer&viewing=${encodeURIComponent(path!)}`)
      await page.getByRole('button', { name: menu!, exact: true }).click()
      const action = page
        .getByRole('menuitem', { name: 'Open in default app', exact: true })
        .or(page.getByRole('button', { name: 'Open in default app', exact: true }))
      await expect(action).toBeVisible()
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('default-app-menu.png'),
      })
      await action.click()
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { defaultAppCalls: string[] }).defaultAppCalls),
        )
        .toEqual([path])
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: menu!, exact: true }).click()
      await expect(action).toBeVisible()
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('default-app-menu-phone.png'),
      })
      await action.click()
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { defaultAppCalls: string[] }).defaultAppCalls),
        )
        .toEqual([path, path])
    })
  }

  test('reports a failed association without closing the viewer', async ({ page }) => {
    await page.goto('/desktop?mode=viewer&viewing=Notes%2Fwelcome.md')
    await page.evaluate(() => {
      ;(window as unknown as { failDefaultApp: boolean }).failDefaultApp = true
    })
    await page.getByRole('button', { name: 'Document actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Open in default app', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(
      'No application is associated with this file',
    )
    await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible()
  })
})

test('ordinary browser menus do not expose system associations', async ({ page }) => {
  await page.goto('/?dir=Notes&viewing=Notes%2Fwelcome.md')
  await page.getByRole('button', { name: 'Document actions', exact: true }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Open in default app', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible()
})
