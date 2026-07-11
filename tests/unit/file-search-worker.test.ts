import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FileSearchResponse, FileSearchStatus } from '@/lib/file-search'

let tempDir = ''
let worker: Worker | undefined
let shutdown: (() => Promise<unknown>) | undefined

afterEach(async () => {
  await shutdown?.().catch(() => undefined)
  shutdown = undefined
  worker?.terminate()
  worker = undefined
  for (let attempt = 0; tempDir && attempt < 5; attempt++) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
      break
    } catch {
      if (attempt === 4) throw new Error(`Failed to remove ${tempDir}`)
      await Bun.sleep(50)
    }
  }
  tempDir = ''
})

function createRpc(target: Worker) {
  let id = 0
  const pending = new Map<number, (response: any) => void>()
  target.addEventListener('message', (event) => {
    const response = event.data as { id: number; ok: boolean; data?: unknown; error?: string }
    pending.get(response.id)?.(response)
    pending.delete(response.id)
  })
  return <T>(type: string, payload: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const requestId = ++id
      pending.set(requestId, (response) => {
        if (response.ok) resolve(response.data as T)
        else reject(new Error(response.error))
      })
      target.postMessage({ id: requestId, type, ...payload })
    })
}

async function waitUntilReady(rpc: ReturnType<typeof createRpc>) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const status = await rpc<FileSearchStatus>('status')
    if (status.state === 'ready') return status
    await Bun.sleep(25)
  }
  throw new Error('Search index did not become ready')
}

async function startSearchWorker(media: string, indexPath: string) {
  worker = new Worker(new URL('../../server/file-search-worker.ts', import.meta.url).href)
  const rpc = createRpc(worker)
  shutdown = () => rpc('shutdown')
  await rpc('init', {
    config: {
      enabled: true,
      indexPath,
      watchMode: 'off',
      maxRecursiveWatchers: 0,
      maxFsConcurrency: 2,
      reconcileDirectoriesPerSecond: 32,
    },
    roots: [{ id: 'root', name: 'Media', path: media, source: 'config' }],
  })
  return rpc
}

async function stopSearchWorker() {
  await shutdown?.()
  shutdown = undefined
  worker?.terminate()
  worker = undefined
}

describe('file search worker', () => {
  test('indexes a root and applies a bounded targeted refresh', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-file-search-'))
    const media = path.join(tempDir, 'media')
    fs.mkdirSync(path.join(media, 'Videos'), { recursive: true })
    fs.writeFileSync(path.join(media, 'Videos', 'Summer Movie.mp4'), 'video')
    fs.writeFileSync(path.join(media, 'notes.txt'), 'notes')

    const rpc = await startSearchWorker(media, path.join(tempDir, 'index', 'files.sqlite'))
    const status = await waitUntilReady(rpc)
    expect(status.watcherCount).toBe(0)

    const initial = await rpc<FileSearchResponse>('search', { query: 'movie', limit: 50 })
    expect(initial.results.map((result) => result.path)).toContain('Videos/Summer Movie.mp4')

    fs.writeFileSync(path.join(media, 'Videos', 'Fresh Photo.jpg'), 'image')
    await rpc('file-change', { directory: 'Videos', changedPath: 'Videos/Fresh Photo.jpg' })
    const deadline = Date.now() + 5_000
    let refreshed: FileSearchResponse | undefined
    while (Date.now() < deadline) {
      refreshed = await rpc<FileSearchResponse>('search', { query: 'fresh', limit: 50 })
      if (refreshed.results.length > 0) break
      await Bun.sleep(25)
    }
    expect(refreshed?.results[0]?.path).toBe('Videos/Fresh Photo.jpg')

    fs.rmSync(path.join(media, 'Videos', 'Summer Movie.mp4'))
    await rpc('file-change', { directory: 'Videos', changedPath: 'Videos/Summer Movie.mp4' })
    const removalDeadline = Date.now() + 5_000
    let removed = false
    while (Date.now() < removalDeadline) {
      const response = await rpc<FileSearchResponse>('search', { query: 'movie', limit: 50 })
      if (response.results.length === 0) {
        removed = true
        break
      }
      await Bun.sleep(25)
    }
    expect(removed).toBe(true)

    let reindexError: Error | undefined
    try {
      await rpc('reindex', { mode: 'full', rootId: 'missing-root' })
    } catch (error) {
      reindexError = error as Error
    }
    expect(reindexError?.message).toContain('Unknown file search root')
  })

  test('reuses a warm index and rebuilds a corrupt database', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-file-search-recovery-'))
    const media = path.join(tempDir, 'media')
    const indexPath = path.join(tempDir, 'index', 'files.sqlite')
    fs.mkdirSync(media, { recursive: true })
    fs.writeFileSync(path.join(media, 'Persistent Note.txt'), 'note')

    let rpc = await startSearchWorker(media, indexPath)
    await waitUntilReady(rpc)
    await stopSearchWorker()

    rpc = await startSearchWorker(media, indexPath)
    const warm = await rpc<FileSearchResponse>('search', { query: 'persistent', limit: 50 })
    expect(warm.results[0]?.path).toBe('Persistent Note.txt')
    await stopSearchWorker()

    fs.writeFileSync(indexPath, 'not a sqlite database')
    rpc = await startSearchWorker(media, indexPath)
    await waitUntilReady(rpc)
    const recovered = await rpc<FileSearchResponse>('search', { query: 'persistent', limit: 50 })
    expect(recovered.results[0]?.path).toBe('Persistent Note.txt')
  })
})
