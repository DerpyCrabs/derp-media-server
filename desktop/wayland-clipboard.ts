import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileUris, parseFileClipboard } from './core'

const execute = promisify(execFile)

export async function readWaylandFiles(): Promise<string[]> {
  for (const type of ['text/uri-list', 'x-special/gnome-copied-files']) {
    try {
      const { stdout } = await execute('wl-paste', ['--no-newline', '--type', type], {
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
      })
      const files = parseFileClipboard(stdout)
      if (files.length) return files
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT')
        throw new Error('Install wl-clipboard to copy and paste files on Wayland')
      // wl-paste exits with 1 when the clipboard does not offer this format.
      if (Number(code) !== 1) throw error
    }
  }
  return []
}

export function writeWaylandFiles(files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('wl-copy', ['--type', 'text/uri-list'], { timeout: 5000 }, (error) => {
      if (error?.code === 'ENOENT')
        reject(new Error('Install wl-clipboard to copy and paste files on Wayland'))
      else if (error) reject(error)
      else resolve()
    })
    child.stdin?.on('error', reject)
    child.stdin?.end(fileUris(files))
  })
}
