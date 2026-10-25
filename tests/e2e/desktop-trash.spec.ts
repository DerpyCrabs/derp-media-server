import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serverOrigin } from '../fixtures/server-ready'

test('desktop trash restores files and links, refuses collisions, and respects configured write boundaries', async ({
  page,
  request,
}) => {
  test.skip(process.platform !== 'linux')
  test.setTimeout(60000)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'derp-trash-'))
  const home = path.join(directory, 'home')
  const writable = path.join(home, 'Writable')
  const dataHome = path.join(directory, 'xdg-data')
  await fs.mkdir(writable, { recursive: true })
  await fs.mkdir(dataHome, { recursive: true })
  const relocatedTrash = path.join(directory, 'relocated-trash')
  await fs.mkdir(relocatedTrash)
  await fs.symlink(relocatedTrash, path.join(dataHome, 'Trash'))
  await fs.mkdir(path.join(home, 'Locked'))
  await fs.writeFile(path.join(writable, 'note.txt'), 'recover me')
  await fs.mkdir(path.join(writable, 'folder'))
  await fs.writeFile(path.join(writable, 'folder', 'inside.txt'), 'keep')
  await fs.symlink(path.join(writable, 'folder'), path.join(writable, 'link'))
  await fs.writeFile(path.join(home, 'Locked', 'private.txt'), 'read only')
  const config = path.join(directory, 'config.json')
  await fs.writeFile(
    config,
    JSON.stringify({
      desktopMode: true,
      mediaDir: home,
      editableFolders: ['Writable'],
      dataPath: path.join(directory, 'data'),
      fileSearch: { enabled: false },
    }),
  )
  const child = spawn(
    path.resolve(process.env.TEST_SERVER_TARGET_DIR ?? 'target', 'release', 'derp-media-server'),
    ['--production'],
    {
      env: {
        ...process.env,
        PORT: '0',
        CONFIG_PATH: config,
        MEDIA_DIR: '',
        HOME: home,
        XDG_DATA_HOME: dataHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  try {
    const origin = await serverOrigin(child)
    const entries = async () =>
      (await (await request.get(`${origin}/api/desktop/trash`)).json()).entries as {
        id: string
        path: string
        editable: boolean
      }[]
    const trash = async (logical: string) => {
      const response = await request.post(`${origin}/api/file-jobs`, {
        data: { operation: 'trash', paths: [logical] },
      })
      expect(response.ok()).toBe(true)
      await expect
        .poll(async () => (await entries()).some((item) => item.path === logical))
        .toBe(true)
    }
    expect((await (await request.get(`${origin}/api/config`)).json()).trashAvailable).toBe(true)
    const forbidden = await request.post(`${origin}/api/file-jobs`, {
      data: { operation: 'trash', paths: ['Locked/private.txt'] },
    })
    expect(forbidden.status()).toBe(403)
    await page.goto(`${origin}/?dir=Writable`)
    const note = page.locator('table').getByText('note.txt', { exact: true })
    await note.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click()
    await expect(
      page.getByText('Move 1 selected item(s) to the system trash?', { exact: false }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Move to trash', exact: true }).click()
    await expect
      .poll(async () => (await entries()).some((item) => item.path === 'Writable/note.txt'))
      .toBe(true)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(note).toHaveCount(0)
    await fs.writeFile(path.join(writable, 'note.txt'), 'replacement')
    await page.getByRole('button', { name: 'Places', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Trash', exact: true }).click()
    const restore = page.getByRole('button', { name: 'Restore', exact: true })
    await restore.click()
    await expect(page.getByRole('alert')).toContainText('already exists')
    expect(await fs.readFile(path.join(writable, 'note.txt'), 'utf8')).toBe('replacement')
    await fs.unlink(path.join(writable, 'note.txt'))
    await restore.click()
    await expect(page.getByRole('status')).toContainText('Restored Writable/note.txt')
    expect(await fs.readFile(path.join(writable, 'note.txt'), 'utf8')).toBe('recover me')
    await expect(restore).toHaveCount(0)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await note.click({ button: 'right' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Move to trash', exact: true })).toHaveCount(0)
    await page.locator('tr[data-file-path="Writable/note.txt"]').focus()
    await page.keyboard.press('Shift+Delete')
    await expect(
      page.getByRole('button', { name: 'Delete permanently', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator('tr[data-file-path="Writable/note.txt"]').focus()
    await page.keyboard.press('Delete')
    await expect(page.getByRole('button', { name: 'Move to trash', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await trash('Writable/link')
    expect(await fs.readFile(path.join(writable, 'folder', 'inside.txt'), 'utf8')).toBe('keep')
    const link = (await entries()).find((item) => item.path === 'Writable/link')!
    expect(
      (await request.post(`${origin}/api/desktop/trash/restore`, { data: { id: link.id } })).ok(),
    ).toBe(true)
    expect((await fs.lstat(path.join(writable, 'link'))).isSymbolicLink()).toBe(true)
    await trash('Writable/folder')
    const folder = (await entries()).find((item) => item.path === 'Writable/folder')!
    expect(
      (await request.post(`${origin}/api/desktop/trash/restore`, { data: { id: folder.id } })).ok(),
    ).toBe(true)
    expect(await fs.readFile(path.join(writable, 'folder', 'inside.txt'), 'utf8')).toBe('keep')

    // Simulate entries deleted by another desktop file manager in the isolated system bin.
    const bin = path.join(dataHome, 'Trash')
    for (const [name, original] of [
      ['outside', path.join(directory, 'outside.txt')],
      ['locked', path.join(home, 'Locked', 'deleted.txt')],
    ]) {
      await fs.writeFile(path.join(bin, 'files', name!), 'retained')
      await fs.writeFile(
        path.join(bin, 'info', `${name}.trashinfo`),
        `[Trash Info]\nPath=${encodeURI(original!)}\nDeletionDate=2026-10-25T10:00:00\n`,
      )
    }
    const listed = await entries()
    expect(listed.map((item) => item.path)).not.toContain('../outside.txt')
    expect(listed).toHaveLength(1)
    expect(listed[0]!.editable).toBe(false)
    expect(
      (
        await request.post(`${origin}/api/desktop/trash/restore`, { data: { id: listed[0]!.id } })
      ).status(),
    ).toBe(403)
    expect(await fs.readFile(path.join(bin, 'files', 'locked'), 'utf8')).toBe('retained')
  } finally {
    await page.goto('about:blank')
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    }
    await fs.rm(directory, { recursive: true, force: true })
  }
})
