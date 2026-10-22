import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

async function freePort(): Promise<number> {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo
      server.close(() => resolve(address.port))
    })
  })
}

for (const multiple of [false, true]) {
  test(`filesystem write access honors OS permissions (${multiple ? 'multiple roots' : 'single root'})`, async ({
    page,
  }) => {
    test.skip(
      process.platform === 'win32' || process.getuid?.() === 0,
      'Requires unprivileged POSIX permissions',
    )
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-filesystem-access-'))
    const media = path.join(temporary, 'media')
    const second = path.join(temporary, 'second')
    const locked = path.join(media, 'locked')
    fs.mkdirSync(locked, { recursive: true })
    fs.mkdirSync(second)
    fs.writeFileSync(path.join(media, 'note.txt'), 'original')
    fs.writeFileSync(path.join(media, 'readonly.txt'), 'protected', { mode: 0o444 })
    fs.writeFileSync(path.join(locked, 'note.txt'), 'locked child')
    fs.chmodSync(locked, 0o555)
    fs.symlinkSync(second, path.join(media, 'escape'))
    const port = await freePort()
    const config = path.join(temporary, 'config.json')
    fs.writeFileSync(
      config,
      JSON.stringify({
        writeAccess: 'filesystem',
        ...(multiple
          ? {
              mediaDirs: [
                { path: media, name: 'First' },
                { path: second, name: 'Second' },
              ],
            }
          : { mediaDir: media }),
        dataPath: path.join(temporary, 'data'),
        fileSearch: { enabled: false },
        port,
      }),
    )
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CONFIG_PATH: config,
      PORT: String(port),
      NODE_ENV: 'production',
    }
    delete env.EDITABLE_FOLDERS
    delete env.MEDIA_DIR
    const binary = path.resolve(
      process.env.TEST_SERVER_TARGET_DIR ?? 'target',
      'release/derp-media-server',
    )
    const server = spawn(binary, ['--production'], { env, stdio: 'ignore' })
    const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
    const base = `http://127.0.0.1:${port}`
    const prefix = multiple ? 'First/' : ''
    const post = (operation: string, data: object) =>
      page.request.post(`${base}/api/files/${operation}`, { data })
    try {
      await expect
        .poll(
          async () => {
            try {
              return (await page.request.get(`${base}/api/config`)).ok()
            } catch {
              return false
            }
          },
          { timeout: 30_000 },
        )
        .toBe(true)
      const settings = await (await page.request.get(`${base}/api/config`)).json()
      expect(settings.writeAccess).toBe('filesystem')
      await page.goto(`${base}/?dir=${multiple ? 'First' : ''}&viewing=${prefix}note.txt`)
      await expect(page.locator('textarea')).toHaveValue('original')
      await page.locator('textarea').fill('edited through UI')
      await expect
        .poll(() => fs.readFileSync(path.join(media, 'note.txt'), 'utf8'))
        .toBe('edited through UI')
      expect(
        (await post('create', { type: 'file', path: `${prefix}new.txt`, content: 'new' })).ok(),
      ).toBe(true)
      expect(
        (
          await post('rename', { oldPath: `${prefix}new.txt`, newPath: `${prefix}renamed.txt` })
        ).ok(),
      ).toBe(true)
      expect((await post('delete', { path: `${prefix}renamed.txt` })).ok()).toBe(true)
      expect(
        (await post('edit', { path: `${prefix}readonly.txt`, content: 'overwrite' })).status(),
      ).toBe(403)
      expect(fs.readFileSync(path.join(media, 'readonly.txt'), 'utf8')).toBe('protected')
      expect((await post('create', { type: 'folder', path: `${prefix}copies` })).ok()).toBe(true)
      expect(
        (
          await post('copy', {
            sourcePath: `${prefix}readonly.txt`,
            destinationDir: `${prefix}copies`,
          })
        ).ok(),
      ).toBe(true)
      expect(fs.readFileSync(path.join(media, 'copies/readonly.txt'), 'utf8')).toBe('protected')
      expect((await post('delete', { path: `${prefix}readonly.txt` })).ok()).toBe(true)

      expect(
        (
          await post('create', { type: 'file', path: `${prefix}locked/new.txt`, content: 'no' })
        ).status(),
      ).toBe(403)
      expect((await post('delete', { path: `${prefix}locked/note.txt` })).status()).toBe(403)
      expect(
        (
          await post('create', { type: 'file', path: `${prefix}../outside.txt`, content: 'no' })
        ).ok(),
      ).toBe(false)
      expect(
        (
          await post('create', { type: 'file', path: `${prefix}escape/outside.txt`, content: 'no' })
        ).ok(),
      ).toBe(false)
      if (multiple) {
        expect((await post('delete', { path: 'First' })).status()).toBe(403)
        expect(
          (
            await post('create', { type: 'file', path: 'Second/new.txt', content: 'second root' })
          ).ok(),
        ).toBe(true)
        expect(fs.readFileSync(path.join(second, 'new.txt'), 'utf8')).toBe('second root')
      }
    } finally {
      server.kill('SIGKILL')
      await exited
      fs.chmodSync(locked, 0o755)
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
}
