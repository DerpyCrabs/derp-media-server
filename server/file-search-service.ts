import { config, getMediaRoots, subscribeMountChanges, type MediaRoot } from '@/lib/config'
import { addFileClient, type FileChangeEvent } from '@/lib/file-change-emitter'
import type { FileSearchResponse, FileSearchStatus } from '@/lib/file-search'

type WorkerResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: string }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

function serializeRoots(roots: MediaRoot[]) {
  return roots.map((root) => ({
    id: root.id,
    name: root.name,
    path: root.path,
    source: root.source,
  }))
}

class FileSearchService {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private started: Promise<void> | null = null
  private fatalError: string | undefined

  start(): Promise<void> {
    if (this.started) return this.started
    this.started = this.startWorker()
    return this.started
  }

  private async startWorker() {
    if (!config.fileSearch.enabled) return
    const worker = new Worker(new URL('./file-search-worker.ts', import.meta.url).href)
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.ok) pending.resolve(response.data)
      else pending.reject(new Error(response.error))
    })
    worker.addEventListener('error', (event) => {
      this.failAll(new Error(event.message || 'File search worker failed'))
    })
    await this.request('init', {
      config: config.fileSearch,
      roots: serializeRoots(getMediaRoots()),
    })
    addFileClient((event) => this.onFileChange(event))
    subscribeMountChanges(() => {
      void this.request('sync-roots', { roots: serializeRoots(getMediaRoots()) }).catch((error) => {
        console.error('[File search] Failed to sync media roots:', error)
      })
    })
  }

  private failAll(error: Error) {
    this.fatalError = error.message
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private onFileChange(event: FileChangeEvent) {
    void this.request('file-change', {
      directory: event.directory,
      changedPath: event.path,
    }).catch((error) => console.error('[File search] Failed to queue file change:', error))
  }

  private request<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!config.fileSearch.enabled) return Promise.reject(new Error('File search is disabled'))
    const worker = this.worker
    if (!worker) return Promise.reject(new Error(this.fatalError ?? 'File search is starting'))
    if (this.pending.size >= 64) return Promise.reject(new Error('File search queue is busy'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      worker.postMessage({ id, type, ...payload })
    })
  }

  async search(query: string, limit: number): Promise<FileSearchResponse> {
    await this.start()
    return this.request<FileSearchResponse>('search', { query, limit })
  }

  async status(): Promise<FileSearchStatus> {
    if (!config.fileSearch.enabled) {
      return {
        state: 'disabled',
        stale: false,
        indexedEntries: 0,
        scannedDirectories: 0,
        watcherCount: 0,
        roots: [],
      }
    }
    await this.start()
    return this.request<FileSearchStatus>('status')
  }

  async reindex(mode: 'reconcile' | 'full', rootId?: string) {
    await this.start()
    return this.request<{ accepted: true }>('reindex', { mode, rootId })
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __fileSearchService: FileSearchService | undefined
}

export const fileSearchService =
  globalThis.__fileSearchService ?? (globalThis.__fileSearchService = new FileSearchService())
