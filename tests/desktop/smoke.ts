import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
import { READER_PDF } from '../fixtures/generate-media'

const temp = await mkdtemp(path.join(tmpdir(), 'derp-native-test-'))
const media = path.join(temp, 'media')
await mkdir(path.join(media, 'Notes'), { recursive: true })
await writeFile(path.join(media, 'Notes', 'note.txt'), 'Native desktop smoke test')
await writeFile(path.join(media, 'Notes', 'reader.pdf'), READER_PDF)
await copyFile('desktop/icon.png', path.join(media, 'Notes', 'picture.png'))
const socket = createServer()
await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
const address = socket.address()
if (!address || typeof address === 'string') throw new Error('No test port')
const port = address.port
await new Promise<void>((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve())),
)
await writeFile(
  path.join(temp, 'server.json'),
  JSON.stringify({
    port,
    mediaDir: media,
    editableFolders: ['Notes'],
    dataPath: path.join(temp, 'data'),
  }),
)
const configHome = path.join(temp, 'config')
await mkdir(path.join(configHome, 'derp-media-server'), { recursive: true })
await writeFile(path.join(configHome, 'derp-media-server/desktop.json'), JSON.stringify({ port }))
const env = Object.fromEntries(
  Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined),
)
delete env.ELECTRON_RUN_AS_NODE
env.XDG_CONFIG_HOME = configHome
env.XDG_STATE_HOME = path.join(temp, 'state')
const executablePath = path.resolve('node_modules/electron/dist/electron')
const main = path.resolve('dist/desktop/main.cjs')
const server = Bun.spawn(
  [
    path.resolve(process.env.TEST_SERVER_BINARY || 'target/test-batch/release/derp-media-server'),
    '--production',
    '--config-path',
    path.join(temp, 'server.json'),
  ],
  { stdout: 'ignore', stderr: 'inherit' },
)
let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined
try {
  await expect
    .poll(
      async () =>
        fetch(`http://127.0.0.1:${port}/api/config`)
          .then((response) => response.ok)
          .catch(() => false),
      { timeout: 20_000 },
    )
    .toBe(true)
  electron = await _electron.launch({
    executablePath,
    args: [main, '--tray'],
    env,
    timeout: 30_000,
  })
  const page = await electron.firstWindow()
  page.on('pageerror', (error) => console.error('Renderer error:', error))
  await expect.poll(() => page.evaluate(() => !!window.derpDesktop)).toBe(true)
  await page.waitForURL(/warm=1/)
  await page.evaluate(() => window.derpDesktop!.openRoot())
  await page.waitForURL(/mode=browser/)
  await expect(page.locator('table tr').filter({ hasText: 'Notes' })).toBeVisible()
  await page.locator('table tr').filter({ hasText: 'Notes' }).click()
  await expect(page).toHaveURL(/dir=Notes/)

  const countVisible = () =>
    electron!.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length,
    )
  const invoke = async (...args: string[]) => {
    const child = Bun.spawn([executablePath, main, ...args], {
      cwd: path.join(media, 'Notes'),
      env,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    expect(await child.exited).toBe(0)
  }
  await invoke('note.txt', 'note.txt')
  await expect.poll(countVisible).toBe(3)
  const noteWindows = electron
    .windows()
    .filter((window) => window.url().includes('viewing=Notes%2Fnote.txt'))
  expect(noteWindows).toHaveLength(2)
  await expect(noteWindows[0]!.getByRole('textbox', { name: 'Enter text…' })).toHaveValue(
    'Native desktop smoke test',
  )
  await invoke('.')
  await expect.poll(countVisible).toBe(4)
  console.log(
    'PASS: CLI opens fresh file/directory windows; internal folder navigation stays in its window',
  )

  await electron.evaluate(async ({ clipboard }) => {
    const saved = []
    for (const item of await clipboard.read()) {
      const payload: Record<string, Blob | Electron.ClipboardBookmark> = {}
      for (const type of item.types) payload[type] = await item.getType(type)
      if (Object.keys(payload).length) saved.push(payload)
    }
    Object.assign(globalThis, { desktopTestClipboard: saved })
  })
  try {
    await page.evaluate(() => window.derpDesktop!.copy(['Notes/note.txt']))
    const clipboardText = await electron.evaluate(async ({ clipboard }) => {
      for (const item of await clipboard.read()) {
        if (item.types.includes('text/uri-list')) {
          const data = await item.getType('text/uri-list')
          if ('text' in data) return data.text()
        }
      }
      return ''
    })
    const fileClipboardText = process.env.WAYLAND_DISPLAY
      ? await new Response(
          Bun.spawn(['wl-paste', '--type', 'text/uri-list'], { stdout: 'pipe' }).stdout,
        ).text()
      : clipboardText
    expect(fileClipboardText).toContain(pathToFileURL(path.join(media, 'Notes/note.txt')).href)
    const outside = path.join(temp, `incoming folder-${path.basename(temp)}`)
    await mkdir(path.join(outside, 'empty'), { recursive: true })
    await writeFile(path.join(outside, 'from outside.txt'), 'copied, not moved')
    await electron.evaluate(async ({ clipboard, ClipboardItem }, uri) => {
      await clipboard.write([
        new ClipboardItem({
          'electron application/osclipboard;format="x-special/gnome-copied-files"': new Blob([
            'cut\n' + uri,
          ]),
        }),
      ])
    }, pathToFileURL(outside).href)
    expect(await page.evaluate(() => window.derpDesktop!.paste('Notes'))).toBe(1)
    expect(
      await readFile(path.join(media, 'Notes', path.basename(outside), 'from outside.txt'), 'utf8'),
    ).toBe('copied, not moved')
    expect(await readFile(path.join(outside, 'from outside.txt'), 'utf8')).toBe('copied, not moved')
    const { stat } = await import('node:fs/promises')
    expect(
      (await stat(path.join(media, 'Notes', path.basename(outside), 'empty'))).isDirectory(),
    ).toBe(true)
    await expect(page.locator('table tr').filter({ hasText: path.basename(outside) })).toBeVisible()
    console.log(
      'PASS: native file clipboard exports URIs, imports Nautilus cut payloads as copies, preserves empty folders, and refreshes the browser',
    )
  } finally {
    await electron.evaluate(async ({ clipboard, ClipboardItem }) => {
      const saved = (
        globalThis as unknown as {
          desktopTestClipboard: Record<string, Blob | Electron.ClipboardBookmark>[]
        }
      ).desktopTestClipboard
      if (saved?.length) await clipboard.write(saved.map((item) => new ClipboardItem(item)))
      else clipboard.clear()
    })
  }

  await invoke('reader.pdf')
  await expect
    .poll(() => electron!.windows().some((window) => window.url().includes('reader.pdf')))
    .toBe(true)
  const reader = electron.windows().find((window) => window.url().includes('reader.pdf'))!
  await expect(reader.getByTestId('reader-page-indicator')).toContainText('Page 1 / 4', {
    timeout: 20_000,
  })
  await reader.getByTestId('reader-page-indicator').click()
  await reader.getByTestId('reader-page-input').fill('3')
  await reader.getByTestId('reader-page-input').press('Enter')
  await expect(reader.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
  await reader.evaluate(() => window.derpDesktop!.close())
  await expect.poll(() => reader.isClosed()).toBe(true)
  await invoke('reader.pdf')
  await expect
    .poll(() => electron!.windows().some((window) => window.url().includes('reader.pdf')))
    .toBe(true)
  const reopened = electron.windows().find((window) => window.url().includes('reader.pdf'))!
  await expect(reopened.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4', {
    timeout: 20_000,
  })
  console.log('PASS: reader progress survives native close and reopen')
} finally {
  if (electron) await electron.close()
  server.kill()
  await server.exited
  await rm(temp, { recursive: true, force: true })
}
