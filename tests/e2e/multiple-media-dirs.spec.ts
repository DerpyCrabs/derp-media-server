import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'

const WORKSPACE_VISIBLE_WINDOW_GROUP = '[data-window-group]:not([data-workspace-window-minimized])'

let server: ChildProcessWithoutNullStreams
let baseUrl: string
let tempDir: string
let moviesDir: string
let showsDir: string
let archiveDir: string
let serverOutput = ''

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, () => {
      const address = srv.address()
      srv.close(() => {
        if (!address || typeof address === 'string') reject(new Error('Failed to allocate port'))
        else resolve(address.port)
      })
    })
  })
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for multi-root server:\n${serverOutput}`)
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function workspaceContent(page: Page) {
  return page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first().locator('.workspace-window-content')
}

function serverCommand(): { executable: string; args: string[] } {
  const executable = path.resolve(
    __dirname,
    '../..',
    process.platform === 'win32'
      ? 'target/release/derp-media-server.exe'
      : 'target/release/derp-media-server',
  )
  return { executable, args: ['--production'] }
}

test.describe.serial('Multiple media directories', () => {
  test.setTimeout(60_000)

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(60_000)

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-multi-media-'))
    moviesDir = path.join(tempDir, 'movies-root')
    showsDir = path.join(tempDir, 'shows-root')
    archiveDir = path.join(tempDir, 'archive-root')
    const dataDir = path.join(tempDir, 'data')
    const configPath = path.join(tempDir, 'config.jsonc')

    writeFile(path.join(moviesDir, 'Incoming', 'movie-note.md'), '# Movie note')
    writeFile(path.join(moviesDir, 'ReadOnly', 'movie-readonly.txt'), 'readonly movie')
    writeFile(path.join(showsDir, 'Downloads', 'episode-note.md'), '# Episode note')
    writeFile(path.join(showsDir, 'ReadOnly', 'show-info.txt'), 'show info')
    writeFile(path.join(archiveDir, 'history.txt'), 'archived history')
    fs.mkdirSync(dataDir, { recursive: true })

    const port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mediaDirs: [
            { path: moviesDir, name: 'Movies', editableFolders: ['Incoming'] },
            { path: showsDir, name: 'Shows', editableFolders: ['Downloads'] },
          ],
          dataPath: dataDir,
          port,
        },
        null,
        2,
      ),
    )

    const command = serverCommand()
    server = spawn(command.executable, command.args, {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        CONFIG_PATH: configPath,
        BATCH_ID: `multi-${port}`,
        NO_PROXY: 'localhost,127.0.0.1',
      },
    })
    server.stdout.on('data', (chunk) => {
      serverOutput += chunk.toString()
    })
    server.stderr.on('data', (chunk) => {
      serverOutput += chunk.toString()
    })

    await waitForServer(baseUrl)
  })

  test.afterAll(async () => {
    if (server && server.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000)
        server!.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        server!.kill()
      })
    }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('lists media roots and applies editable folders per root', async ({ page }) => {
    await page.goto(baseUrl)
    await expect(page.locator('table').getByText('Movies', { exact: true })).toBeVisible()
    await expect(page.locator('table').getByText('Shows', { exact: true })).toBeVisible()

    await page.getByText('Movies', { exact: true }).click()
    await expect(page.locator('table').getByText('Incoming', { exact: true })).toBeVisible()

    await page.getByText('Incoming', { exact: true }).click()
    await expect(page.locator('table').getByText('movie-note.md')).toBeVisible()
    await expect(page.locator('button[title="Create new file"]')).toBeVisible()

    const createResponse = await page.request.post(`${baseUrl}/api/files/create`, {
      data: { type: 'file', path: 'Movies/Incoming/api-created.md', content: 'from api' },
    })
    expect(createResponse.ok()).toBe(true)
    expect(fs.existsSync(path.join(moviesDir, 'Incoming', 'api-created.md'))).toBe(true)
    expect(fs.existsSync(path.join(showsDir, 'Incoming', 'api-created.md'))).toBe(false)

    const forbiddenResponse = await page.request.post(`${baseUrl}/api/files/create`, {
      data: { type: 'file', path: 'Shows/ReadOnly/blocked.md', content: 'blocked' },
    })
    expect(forbiddenResponse.status()).toBe(403)
    expect(fs.existsSync(path.join(showsDir, 'ReadOnly', 'blocked.md'))).toBe(false)
  })

  test('workspace browser navigates root-prefixed media directories', async ({ page }) => {
    await page.goto(`${baseUrl}/workspace`)
    await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()

    const content = workspaceContent(page)
    await expect(content.getByText('Movies', { exact: true })).toBeVisible()
    await expect(content.getByText('Shows', { exact: true })).toBeVisible()

    await content.getByText('Shows', { exact: true }).click()
    await expect(content.getByText('Downloads', { exact: true })).toBeVisible()
    await expect(content.getByText('ReadOnly', { exact: true })).toBeVisible()

    await content.getByText('Downloads', { exact: true }).click()
    await expect(content.getByText('episode-note.md')).toBeVisible()
  })

  test('adds, renames and removes a read-only runtime root without restart', async ({ page }) => {
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Open theme settings' }).click()
    await page.getByRole('button', { name: 'Media directories' }).click()
    await page.getByLabel('Media directory name').fill('Archive')
    await page.getByLabel('Media directory path').fill(archiveDir)
    await page.getByRole('button', { name: 'Add directory' }).click()
    await expect(page.getByText(archiveDir)).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    const mountsResponse = await page.request.get(`${baseUrl}/api/admin/mounts`)
    const mount = (await mountsResponse.json()).mounts[0] as { id: string }
    await expect(page.getByText('Archive', { exact: true })).toBeVisible()
    await page.getByText('Archive', { exact: true }).click()
    await expect(page.getByText('history.txt')).toBeVisible()
    await expect(page.locator('button[title="Create new file"]')).toHaveCount(0)

    await page.goto(`${baseUrl}/workspace`)
    await page.getByRole('button', { name: 'Open settings' }).click()
    await page.getByRole('button', { name: 'Media directories' }).click()
    await expect(page.getByText(archiveDir)).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    const writeResponse = await page.request.post(`${baseUrl}/api/files/create`, {
      data: { type: 'file', path: 'Archive/blocked.txt', content: 'blocked' },
    })
    expect(writeResponse.status()).toBe(403)
    expect(fs.existsSync(path.join(archiveDir, 'blocked.txt'))).toBe(false)

    const renameResponse = await page.request.patch(`${baseUrl}/api/admin/mounts/${mount.id}`, {
      data: { name: 'Cold Storage', path: archiveDir },
    })
    expect(renameResponse.ok()).toBe(true)
    await page.goto(baseUrl)
    await page.getByText('Cold Storage', { exact: true }).click()
    await expect(page.getByText('history.txt')).toBeVisible()

    const persistedMounts = await page.request.get(`${baseUrl}/api/admin/mounts`)
    expect((await persistedMounts.json()).mounts[0]).toMatchObject({
      id: mount.id,
      name: 'Cold Storage',
    })
    expect(fs.existsSync(path.join(tempDir, 'data', 'app.sqlite3'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'data', 'mounts.json'))).toBe(false)

    const deleteResponse = await page.request.delete(`${baseUrl}/api/admin/mounts/${mount.id}`)
    expect(deleteResponse.ok()).toBe(true)
  })
})
