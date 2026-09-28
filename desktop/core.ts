import { readFile, mkdir, writeFile, lstat, readdir, realpath } from 'node:fs/promises'
import { openAsBlob } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface DesktopConfig {
  port: number
}
export interface ResolvedFile {
  path: string
  absolutePath: string
  isDirectory: boolean
  mediaType: string
}

export function validateConfig(value: unknown): DesktopConfig {
  const port = (value as Partial<DesktopConfig> | null)?.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('desktop.json must contain an integer port between 1 and 65535')
  return { port }
}

export function configDirectory(env = process.env): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'derp-media-server')
}

export async function loadConfig(directory = configDirectory()): Promise<DesktopConfig> {
  await mkdir(directory, { recursive: true })
  const filename = path.join(directory, 'desktop.json')
  try {
    await writeFile(filename, JSON.stringify({ port: 3000 }, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return validateConfig(JSON.parse(await readFile(filename, 'utf8')))
}

export function parseArguments(args: string[], cwd: string) {
  let tray = false
  let literal = false
  const paths: string[] = []
  for (const arg of args) {
    if (!literal && arg === '--') {
      literal = true
      continue
    }
    if (!literal && arg === '--tray') {
      tray = true
      continue
    }
    if (!literal && (arg === '--help' || arg === '-h')) return { tray, paths, help: true }
    if (!literal && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    paths.push(arg.startsWith('file:') ? fileURLToPath(arg) : path.resolve(cwd, arg))
  }
  return { tray, paths, help: false }
}

export function parseFileClipboard(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('file:'))
        .map((uri) => fileURLToPath(uri)),
    ),
  ]
}

export function fileUris(paths: string[]): string {
  return paths.map((file) => pathToFileURL(file).href).join('\r\n') + '\r\n'
}

export class DesktopServer {
  readonly origin: string
  constructor(config: DesktopConfig) {
    this.origin = `http://127.0.0.1:${config.port}`
  }

  async request<T>(route: string, body: unknown): Promise<T> {
    const response = await fetch(this.origin + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    return this.response<T>(response)
  }

  async response<T>(response: Response): Promise<T> {
    const body = (await response.json()) as T & { error?: string }
    if (!response.ok) throw new Error(body.error || `Server returned ${response.status}`)
    return body
  }

  resolve(file: string, absolute = false): Promise<ResolvedFile> {
    return this.request('/api/desktop/resolve', { path: file, absolute })
  }

  async importFiles(sources: string[], destination: string): Promise<number> {
    if (!sources.length) return 0
    const target = await this.resolve(destination)
    if (!target.isDirectory) throw new Error('Choose a destination folder')
    const targetReal = await realpath(target.absolutePath)
    let count = 0
    const visit = async (source: string, logical: string) => {
      if (path.basename(source).includes('\\')) throw new Error('Unsupported filename: ' + source)
      const info = await lstat(source)
      if (info.isSymbolicLink()) throw new Error(`Symbolic links cannot be imported: ${source}`)
      if (info.isDirectory()) {
        await this.request('/api/files/create', { type: 'folder', path: logical })
        for (const name of await readdir(source))
          await visit(path.join(source, name), `${logical}/${name}`)
      } else if (info.isFile()) {
        const form = new FormData()
        form.append('targetDir', logical.split('/').slice(0, -1).join('/'))
        form.append('files', await openAsBlob(source), path.basename(logical))
        const response = await fetch(this.origin + '/api/files/upload?create_only=true', {
          method: 'POST',
          body: form,
          redirect: 'error',
        })
        await this.response(response)
        count++
      } else throw new Error(`Only regular files and directories can be imported: ${source}`)
    }
    for (const source of sources) {
      const sourceReal = await realpath(source)
      const relative = path.relative(sourceReal, targetReal)
      if (
        !relative ||
        (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
      )
        throw new Error('Cannot copy a folder into itself')
      const name = path.basename(source)
      if (!name || name.includes('\\')) throw new Error('Unsupported filename')
      const logical = destination ? `${destination}/${name}` : name
      // Reserve the destination using the server's create-only mutation APIs.
      await visit(source, logical)
    }
    return count
  }
}
