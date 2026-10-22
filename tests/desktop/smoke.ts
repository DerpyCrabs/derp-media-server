import { chromium, expect as baseExpect, type Browser, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
import { READER_PDF } from '../fixtures/generate-media'

const expect = baseExpect.configure({ timeout: 20000 })

async function freePort() {
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return address.port
}
const temp = await mkdtemp(path.join(tmpdir(), 'derp-qt-test-'))
console.log('Test files:', temp)
const media = path.join(temp, 'media')
await mkdir(path.join(media, 'Notes', 'nested'), { recursive: true })
await mkdir(path.join(media, 'Notes', 'other-folder'), { recursive: true })
await writeFile(path.join(media, 'Notes', 'note.txt'), 'Native desktop smoke test')
await writeFile(path.join(media, 'Notes', 'second.txt'), 'Second selection')
await writeFile(path.join(media, 'Notes', 'reader.pdf'), READER_PDF)
await copyFile('desktop/icon.png', path.join(media, 'Notes', 'picture.png'))
const port = await freePort()
const debugPort = await freePort()
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
const env = {
  ...process.env,
  XDG_CONFIG_HOME: configHome,
  XDG_STATE_HOME: path.join(temp, 'state'),
  QT_QPA_PLATFORM: 'wayland',
  QTWEBENGINE_REMOTE_DEBUGGING: `127.0.0.1:${debugPort}`,
  DERP_PORTAL_BUS_NAME: `org.freedesktop.impl.portal.desktop.derp.test${process.pid}`,
}
const executable = path.resolve('dist/desktop/derp-media-client')
const server = Bun.spawn(
  [
    path.resolve(process.env.TEST_SERVER_BINARY || 'target/test-batch/release/derp-media-server'),
    '--production',
    '--config-path',
    path.join(temp, 'server.json'),
  ],
  { stdout: 'ignore', stderr: Bun.file(path.join(temp, 'server.log')) },
)
let native: ReturnType<typeof Bun.spawn> | undefined
let browser: Browser | undefined
let parent: ReturnType<typeof Bun.spawn> | undefined
let parentHandle = ''
const requests: ReturnType<typeof Bun.spawn>[] = []
try {
  await expect
    .poll(
      () =>
        fetch(`http://127.0.0.1:${port}/api/config`)
          .then((response) => response.ok)
          .catch(() => false),
      { timeout: 20000 },
    )
    .toBe(true)
  native = Bun.spawn([executable, '--tray'], {
    env,
    stdout: 'ignore',
    stderr: Bun.file(path.join(temp, 'qt.log')),
  })
  await expect
    .poll(
      () =>
        fetch(`http://127.0.0.1:${debugPort}/json/version`)
          .then((response) => response.ok)
          .catch(() => false),
      { timeout: 20000 },
    )
    .toBe(true)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true })
  const context = browser.contexts()[0]!
  const pages = () => context.pages().filter((page) => !page.isClosed())
  const invoke = async (...args: string[]) => {
    const child = Bun.spawn([executable, ...args], {
      cwd: path.join(media, 'Notes'),
      env,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    expect(await child.exited).toBe(0)
  }
  const waitPage = async (match: (page: Page) => boolean) => {
    await expect.poll(() => pages().some(match), { timeout: 15000 }).toBe(true)
    return pages().find(match)!
  }
  await invoke('.')
  const page = await waitPage((page) => page.url().includes('dir=Notes'))
  await expect(page.locator('[data-file-path="Notes/note.txt"]')).toBeVisible()
  await page.locator('[data-file-path="Notes/nested"]').click()
  await expect(page).toHaveURL(/dir=Notes%2Fnested/)
  await invoke('note.txt', 'note.txt')
  await expect
    .poll(() => pages().filter((page) => page.url().includes('viewing=Notes%2Fnote.txt')).length)
    .toBe(2)
  for (const note of pages().filter((page) => page.url().includes('viewing=Notes%2Fnote.txt'))) {
    await expect(note.getByRole('textbox', { name: 'Enter text…' })).toHaveValue(
      'Native desktop smoke test',
    )
    await note.evaluate(() => window.derpDesktop!.close())
  }
  console.log('PASS: Qt CLI opens fresh windows and shared browser navigates in place')

  parent = Bun.spawn([path.resolve('dist/desktop/derp-portal-test-parent')], {
    env,
    stdout: 'pipe',
    stderr: Bun.file(path.join(temp, 'parent.log')),
  })
  const parentOutput = parent.stdout as ReadableStream<Uint8Array>
  const parentReader = parentOutput.getReader()
  parentHandle = new TextDecoder().decode((await parentReader.read()).value).trim()
  expect(parentHandle).toMatch(/^wayland:.+/)

  function request(method: string, options: Record<string, unknown>, extra = {}) {
    const child = Bun.spawn(
      [
        'python',
        'tests/desktop/portal-request.py',
        JSON.stringify({ method, options, parent: parentHandle, ...extra }),
      ],
      { env, stdout: 'pipe', stderr: 'inherit' },
    )
    requests.push(child)
    return {
      child,
      result: async () => {
        const output = await new Response(child.stdout).text()
        expect(await child.exited).toBe(0)
        return JSON.parse(output) as [
          number,
          { uris?: string[]; current_filter?: unknown; choices?: unknown },
        ]
      },
    }
  }
  async function picker(checkNotes = true) {
    let found: Page | undefined
    await expect
      .poll(
        async () => {
          for (const candidate of pages())
            if (
              await candidate
                .getByRole('form', { name: 'File picker' })
                .count()
                .catch(() => 0)
            ) {
              found = candidate
              return true
            }
          return false
        },
        { timeout: 15000 },
      )
      .toBe(true)
    if (checkNotes)
      await expect(
        found!.locator('[data-file-path="Notes/note.txt"], [data-file-path="Notes/nested"]'),
      ).not.toHaveCount(0)
    return found!
  }
  const multi = request('OpenFile', {
    multiple: true,
    current_folder: path.join(media, 'Notes'),
    filters: [
      ['Text', [[0, '*.txt']]],
      ['All files', [[0, '*']]],
    ],
    choices: [
      [
        'encoding',
        'Encoding',
        [
          ['utf8', 'UTF-8'],
          ['ascii', 'ASCII'],
        ],
        'utf8',
      ],
    ],
  })
  const select = await picker()
  await expect(select.getByRole('button', { name: 'Display options', exact: true })).toBeVisible()
  await expect(select.locator('[data-file-path="Notes/reader.pdf"]')).toHaveCount(0)
  const clients = JSON.parse(
    await new Response(Bun.spawn(['hyprctl', 'clients', '-j'], { stdout: 'pipe' }).stdout).text(),
  ) as { pid: number; floating: boolean; xwayland: boolean; title: string }[]
  const dialog = clients.find(
    (client) => client.pid === native!.pid && client.title === 'Derp picker test',
  )
  expect(dialog).toBeDefined()
  expect(dialog!.floating).toBe(true)
  expect(dialog!.xwayland).toBe(false)
  await select.locator('[data-file-path="Notes/note.txt"]').click()
  await select.locator('[data-file-path="Notes/second.txt"]').click({ modifiers: ['Control'] })
  await select.screenshot({ path: path.join(temp, 'picker.png') })
  await select.getByRole('button', { name: 'Open', exact: true }).click()
  const selected = await multi.result()
  expect(selected[0]).toBe(0)
  expect(selected[1].uris).toEqual(
    ['note.txt', 'second.txt'].map((name) => pathToFileURL(path.join(media, 'Notes', name)).href),
  )
  expect(selected[1].choices).toEqual([['encoding', 'utf8']])
  expect(selected[1].current_filter).toEqual(['Text', [[0, '*.txt']]])
  await expect.poll(() => select.isClosed()).toBe(true)
  console.log(
    'PASS: native Wayland floating dialog, full shared browser, multiple files, filters and choices',
  )

  const folder = request('OpenFile', {
    directory: true,
    multiple: true,
    current_folder: path.join(media, 'Notes'),
  })
  const folderPage = await picker()
  await folderPage.locator('[data-file-path="Notes/nested"]').click()
  await folderPage.locator('[data-file-path="Notes/other-folder"]').click({ modifiers: ['Shift'] })
  await folderPage.getByRole('button', { name: 'Select folder', exact: true }).click()
  expect((await folder.result())[1].uris).toEqual(
    ['nested', 'other-folder'].map((name) => pathToFileURL(path.join(media, 'Notes', name)).href),
  )
  await expect.poll(() => folderPage.isClosed()).toBe(true)

  const keyboard = request('OpenFile', {
    multiple: true,
    current_folder: path.join(media, 'Notes'),
    filters: [['Text', [[0, '*.txt']]]],
  })
  const keyboardPage = await picker()
  await keyboardPage.locator('[data-file-path="Notes/note.txt"]').focus()
  await keyboardPage.keyboard.press('Control+a')
  await keyboardPage.keyboard.press('Enter').catch((error: Error) => {
    if (!error.message.includes('has been closed')) throw error
  })
  expect((await keyboard.result())[1].uris).toHaveLength(2)
  await expect.poll(() => keyboardPage.isClosed()).toBe(true)

  const rejected = request('SaveFile', {
    current_folder: path.join(media, 'Notes'),
    current_name: '../escape.txt',
  })
  const rejectedPage = await picker()
  await rejectedPage.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(rejectedPage.getByRole('alert')).toContainText('without directory separators')
  await rejectedPage.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await rejected.result())[0]).toBe(1)
  await expect.poll(() => rejectedPage.isClosed()).toBe(true)

  const readonly = request('SaveFile', { current_folder: media, current_name: 'denied.txt' })
  const readonlyPage = await picker(false)
  await readonlyPage.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(readonlyPage.getByRole('alert')).toContainText('editable folder')
  await readonlyPage.keyboard.press('Escape').catch((error: Error) => {
    if (!error.message.includes('has been closed')) throw error
  })
  expect((await readonly.result())[0]).toBe(1)
  await expect.poll(() => readonlyPage.isClosed()).toBe(true)

  const save = request('SaveFile', {
    current_folder: path.join(media, 'Notes'),
    current_name: 'note.txt',
  })
  const savePage = await picker()
  await savePage.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(savePage.getByRole('alertdialog')).toBeVisible()
  await savePage.getByRole('button', { name: 'Replace', exact: true }).click()
  expect((await save.result())[1].uris).toEqual([
    pathToFileURL(path.join(media, 'Notes/note.txt')).href,
  ])
  await expect.poll(() => savePage.isClosed()).toBe(true)
  const saveMany = request('SaveFiles', {
    current_folder: path.join(media, 'Notes'),
    files: ['note.txt', 'new.txt'],
  })
  const destination = await picker()
  await destination.getByRole('button', { name: 'Select folder', exact: true }).click()
  expect((await saveMany.result())[1].uris).toEqual(
    ['note (1).txt', 'new.txt'].map((name) => pathToFileURL(path.join(media, 'Notes', name)).href),
  )
  await expect.poll(() => destination.isClosed()).toBe(true)
  const cancel = request('OpenFile', {}, { cancel: true })
  expect((await cancel.result())[0]).toBe(1)
  console.log(
    'PASS: destination folders, overwrite confirmation, SaveFiles collision naming and portal cancellation',
  )

  await invoke('reader.pdf')
  const reader = await waitPage((page) => page.url().includes('reader.pdf'))
  await expect(reader.getByTestId('reader-page-indicator')).toContainText('Page 1 / 4', {
    timeout: 20000,
  })
  await reader.getByTestId('reader-settings-button').click()
  await reader.getByRole('button', { name: 'page', exact: true }).click()
  await reader.getByTestId('reader-page-indicator').click()
  await reader.getByTestId('reader-page-input').fill('3')
  await reader.getByTestId('reader-page-input').press('Enter')
  await expect(reader.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
  await reader.evaluate(() => window.derpDesktop!.close())
  await expect.poll(() => reader.isClosed()).toBe(true)
  await invoke('reader.pdf')
  const reopened = await waitPage((page) => page.url().includes('reader.pdf'))
  await expect(reopened.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4', {
    timeout: 20000,
  })
  console.log('PASS: reader progress survives Qt window close and reopen')

  await page.bringToFront()
  await page.evaluate(() => window.derpDesktop!.copy(['Notes/note.txt']))
  const copied = await new Response(
    Bun.spawn(['wl-paste', '--type', 'text/uri-list'], { stdout: 'pipe' }).stdout,
  ).text()
  expect(copied).toContain(pathToFileURL(path.join(media, 'Notes/note.txt')).href)
  const outside = path.join(temp, 'incoming')
  await mkdir(path.join(outside, 'empty'), { recursive: true })
  await writeFile(path.join(outside, 'outside.txt'), 'copied, not moved')
  const copy = Bun.spawn(['wl-copy', '--type', 'x-special/gnome-copied-files'], {
    stdin: new Blob(['cut\n' + pathToFileURL(outside).href]),
    stdout: 'ignore',
  })
  expect(await copy.exited).toBe(0)
  expect(await page.evaluate(() => window.derpDesktop!.paste('Notes'))).toBe(1)
  expect(await readFile(path.join(media, 'Notes/incoming/outside.txt'), 'utf8')).toBe(
    'copied, not moved',
  )
  expect(await readFile(path.join(outside, 'outside.txt'), 'utf8')).toBe('copied, not moved')
  expect((await stat(path.join(media, 'Notes/incoming/empty'))).isDirectory()).toBe(true)
  console.log(
    'PASS: Wayland clipboard exports file URIs and imports Nautilus cut as copy with empty folders',
  )
} finally {
  for (const request of requests) if (request.exitCode === null) request.kill()
  if (parent) {
    parent.kill()
    await parent.exited
  }
  let nativeExit: number | undefined
  // Qt owns the browser process; its CDP connection closes when the native app exits.
  if (native) {
    native.kill()
    nativeExit = await native.exited
  }
  if (browser) await browser.close()
  server.kill()
  await server.exited
  if (process.env.KEEP_DESKTOP_TEST_FILES !== '1') await rm(temp, { recursive: true, force: true })
  if (nativeExit !== undefined) {
    expect(nativeExit).toBe(0)
    console.log(
      'PASS: native shutdown exits normally after flushing windows and closing the warm spare',
    )
  }
}
