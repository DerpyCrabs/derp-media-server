import type { FileItem } from '@/lib/types'
import type { ResourceSummary } from '@/lib/resource'
import { buildOfflineRollbackPlan, executeOfflineDownload } from './offline-download-lifecycle'
import { publishOfflineJob, type OfflineJobScope } from './offline-job-observer'
import { generateOfflineThumbnail } from './offline-thumbnail'
import { ensureOfflineRenderersForFile } from './offline-renderers'
import {
  createPhysicalOfflinePathCoordinator,
  type PhysicalOfflinePathRun,
} from './physical-offline-paths'

const DATABASE = 'derp-offline-v1'
const STORE = 'entries'

export type StoredOfflineEntry = {
  path: string
  name: string
  type: string
  size: number
  extension: string
  isDirectory: boolean
  blob?: Blob
  mediaUrl?: string
  fileName?: string
  thumbnailUrl?: string
  thumbnailBlob?: Blob
  resource?: ResourceSummary
}

const WEB_OFFLINE_CATALOG_EVENT = 'derp-offline-catalog'

declare global {
  interface Window {
    __DERP_WEB_OFFLINE_PATHS__?: string[]
  }
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'path' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function allEntries(): Promise<StoredOfflineEntry[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result as StoredOfflineEntry[])
    request.onerror = () => reject(request.error)
  })
}

export async function readWebOfflineEntries(): Promise<readonly StoredOfflineEntry[]> {
  return allEntries()
}

export function subscribeWebOfflineCatalog(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(WEB_OFFLINE_CATALOG_EVENT, listener)
  return () => window.removeEventListener(WEB_OFFLINE_CATALOG_EVENT, listener)
}

async function put(entry: StoredOfflineEntry): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function removePhysicalFile(entry: StoredOfflineEntry) {
  if (!entry.fileName || !navigator.storage?.getDirectory) return
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(entry.fileName).catch(() => undefined)
}

function isAtOrBelowPath(path: string, root: string): boolean {
  return !root || path === root || path.startsWith(`${root}/`)
}

async function refreshCatalog() {
  window.__DERP_WEB_OFFLINE_PATHS__ = (await allEntries()).map((entry) => entry.path)
  window.dispatchEvent(new Event(WEB_OFFLINE_CATALOG_EVENT))
}

export async function initializeWebOfflineCatalog(): Promise<void> {
  if (!('indexedDB' in window)) return
  await refreshCatalog()
  void navigator.storage?.persist?.()
}

export function webOfflineSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.isSecureContext || window.location.hostname === 'localhost') &&
    'indexedDB' in window &&
    'serviceWorker' in window.navigator
  )
}

export async function requireActiveServiceWorker() {
  if (!webOfflineSupported()) throw new Error('Offline mode requires HTTPS or localhost')
  await navigator.serviceWorker.ready
  if (navigator.serviceWorker.controller) return
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', controlled)
      reject(new Error('Service worker is not controlling this page yet'))
    }, 5_000)
    const controlled = () => {
      if (!navigator.serviceWorker.controller) return
      window.clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener('controllerchange', controlled)
      resolve()
    }
    navigator.serviceWorker.addEventListener('controllerchange', controlled)
  })
}

type DownloadSource = {
  item: FileItem
  apiPath: string
  displayPath: string
  listBaseUrl?: string
  mediaBaseUrl: string
  scope?: OfflineJobScope
  jobPath?: string
  jobName?: string
}

const physicalOfflinePaths = createPhysicalOfflinePathCoordinator()
const activeDownloads = new Map<string, PhysicalOfflinePathRun>()
const retrySources = new Map<string, DownloadSource>()

function downloadKey(scope: OfflineJobScope, path: string): string {
  return `${scope}\0${path}`
}

export function cancelWebOffline(path: string, scope: OfflineJobScope = 'owner') {
  activeDownloads.get(downloadKey(scope, path))?.cancel()
}

export function retryWebOffline(path: string, scope: OfflineJobScope = 'owner') {
  const source = retrySources.get(downloadKey(scope, path))
  return source ? saveForWebOffline(source) : false
}

export async function webOfflineUsage() {
  const entries = await allEntries()
  return {
    used: entries.reduce((sum, entry) => sum + entry.size + (entry.thumbnailBlob?.size ?? 0), 0),
    entries: entries.length,
  }
}

async function saveSource(
  source: DownloadSource,
  progress: { completed: number; written: string[]; physicalFiles: string[] },
  signal: AbortSignal,
) {
  const { item, apiPath, displayPath } = source
  const scope = source.scope ?? 'owner'
  const jobPath = source.jobPath ?? displayPath
  const jobName = source.jobName ?? item.name
  if (item.isDirectory) {
    await put({
      path: displayPath,
      name: item.name,
      type: 'folder',
      size: 0,
      extension: '',
      isDirectory: true,
      ...(item.resource ? { resource: item.resource } : {}),
    })
    progress.written.push(displayPath)
    if (!source.listBaseUrl) return
    const listUrl = new URL(source.listBaseUrl)
    listUrl.searchParams.set('dir', apiPath)
    const response = await fetch(listUrl, { credentials: 'include', signal })
    if (!response.ok)
      throw Object.assign(new Error(`Could not list ${displayPath}`), { status: response.status })
    const body = (await response.json()) as { files: FileItem[] }
    for (const child of body.files) {
      const childApiPath = apiPath ? `${apiPath}/${child.name}` : child.name
      const childDisplayPath = displayPath ? `${displayPath}/${child.name}` : child.name
      await saveSource(
        {
          ...source,
          item: child,
          apiPath: childApiPath,
          displayPath: childDisplayPath,
        },
        progress,
        signal,
      )
    }
    return
  }

  await ensureOfflineRenderersForFile(item)
  const mediaUrl = new URL(
    apiPath.split('/').map(encodeURIComponent).join('/'),
    source.mediaBaseUrl,
  )
  const response = await fetch(mediaUrl, { credentials: 'include', signal })
  if (!response.ok)
    throw Object.assign(new Error(`Could not download ${displayPath}`), { status: response.status })
  const totalBytes = Number(response.headers.get('content-length')) || item.size || 0
  publishOfflineJob({
    state: 'running',
    scope,
    name: jobName,
    path: jobPath,
    completed: progress.completed,
    totalBytes,
    downloadedBytes: 0,
  })
  let blob: Blob | undefined
  let localFile: Blob | undefined
  let fileName: string | undefined
  let size = 0
  if (response.body && navigator.storage?.getDirectory) {
    fileName = `offline-${crypto.randomUUID()}`
    progress.physicalFiles.push(fileName)
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    const reader = response.body.getReader()
    let downloadedBytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        await writable.write(chunk.value)
        downloadedBytes += chunk.value.byteLength
        publishOfflineJob({
          state: 'running',
          scope,
          name: jobName,
          path: jobPath,
          completed: progress.completed,
          totalBytes,
          downloadedBytes,
        })
      }
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => undefined)
      throw error
    }
    size = (await handle.getFile()).size
    localFile = await handle.getFile()
  } else {
    blob = await response.blob()
    localFile = blob
    size = blob.size
  }
  const thumbnailUrl = mediaUrl.pathname.replace('/media/', '/thumbnail/')
  let thumbnailBlob: Blob | undefined
  if (localFile && (item.type === 'image' || item.type === 'video')) {
    thumbnailBlob = await generateOfflineThumbnail(localFile, item.type)
  }
  if (!thumbnailBlob && item.type === 'video') {
    const thumbnailResponse = await fetch(thumbnailUrl, { credentials: 'include' }).catch(
      () => null,
    )
    if (thumbnailResponse?.ok) thumbnailBlob = await thumbnailResponse.blob()
  }
  await put({
    path: displayPath,
    name: item.name,
    type: item.type,
    size,
    extension: item.extension,
    isDirectory: false,
    blob,
    fileName,
    mediaUrl: mediaUrl.pathname,
    thumbnailUrl,
    thumbnailBlob,
    ...(item.resource ? { resource: item.resource } : {}),
  })
  progress.written.push(displayPath)
  progress.completed += 1
  publishOfflineJob({
    state: 'running',
    scope,
    name: jobName,
    path: jobPath,
    completed: progress.completed,
  })
}

export function saveForWebOffline(source: DownloadSource): boolean {
  if (!webOfflineSupported()) return false
  const scope = source.scope ?? 'owner'
  const trackedSource = {
    ...source,
    scope,
    jobPath: source.jobPath ?? source.displayPath,
    jobName: source.jobName ?? source.item.name,
  }
  const key = downloadKey(scope, trackedSource.jobPath)
  publishOfflineJob({
    state: 'queued',
    scope,
    name: trackedSource.jobName,
    path: trackedSource.jobPath,
    totalBytes: source.item.size || 0,
  })
  retrySources.set(key, trackedSource)
  activeDownloads.get(key)?.cancel()
  let run!: PhysicalOfflinePathRun
  run = physicalOfflinePaths.schedule(trackedSource.displayPath, async (signal) => {
    const progress = { completed: 0, written: [] as string[], physicalFiles: [] as string[] }
    let previousEntries: StoredOfflineEntry[] = []
    const outcome = await executeOfflineDownload(
      async () => {
        previousEntries = (await allEntries()).filter((entry) =>
          isAtOrBelowPath(entry.path, trackedSource.displayPath),
        )
        await requireActiveServiceWorker()
        await saveSource(trackedSource, progress, signal)
        const saved = await allEntries()
        if (!saved.some((entry) => entry.path === source.displayPath)) {
          throw new Error('Offline data could not be read back')
        }
        await refreshCatalog()
      },
      async () => {
        const rollback = buildOfflineRollbackPlan(
          previousEntries,
          await allEntries(),
          progress.written,
        )
        const db = await database()
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        for (const path of rollback.deletePaths) {
          store.delete(path)
        }
        for (const entry of rollback.restore) {
          store.put(entry)
        }
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('Offline cleanup transaction aborted'))
        })
        await Promise.all(rollback.discardPhysical.map(removePhysicalFile))
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory().catch(() => null)
          const discarded = new Set(
            rollback.discardPhysical.flatMap((entry) => (entry.fileName ? [entry.fileName] : [])),
          )
          await Promise.all(
            progress.physicalFiles
              .filter((name) => !discarded.has(name))
              .map((name) => root?.removeEntry(name).catch(() => undefined)),
          )
        }
        await refreshCatalog()
      },
    )

    if (activeDownloads.get(key) !== run) return
    activeDownloads.delete(key)
    if (outcome.kind === 'succeeded') {
      retrySources.delete(key)
      publishOfflineJob({
        state: 'succeeded',
        scope,
        name: trackedSource.jobName,
        path: trackedSource.jobPath,
      })
      return
    }

    const status = (outcome.error as { status?: number }).status
    const errorKind =
      outcome.error instanceof DOMException && outcome.error.name === 'QuotaExceededError'
        ? 'quota'
        : status === 401 || status === 403
          ? 'auth'
          : outcome.error instanceof DOMException && outcome.error.name === 'AbortError'
            ? 'cancelled'
            : outcome.error instanceof TypeError
              ? 'network'
              : 'unsupported-format'
    const originalMessage =
      outcome.error instanceof Error ? outcome.error.message : 'Offline download failed'
    const cleanupMessage =
      outcome.cleanupError instanceof Error
        ? ` Cleanup failed: ${outcome.cleanupError.message}`
        : outcome.cleanupError === undefined
          ? ''
          : ' Cleanup failed.'
    publishOfflineJob({
      state: errorKind === 'cancelled' ? 'cancelled' : 'failed',
      scope,
      name: trackedSource.jobName,
      path: trackedSource.jobPath,
      errorKind,
      message: `${originalMessage}${cleanupMessage}`,
    })
  })
  activeDownloads.set(key, run)
  void run.completion.catch(() => undefined)
  return true
}

function scheduleWebOfflineRemoval(
  path: string,
  name: string,
  scope: OfflineJobScope = 'owner',
): PhysicalOfflinePathRun | null {
  if (!webOfflineSupported()) return null
  const normalized = path.replace(/^\/+|\/+$/g, '')
  return physicalOfflinePaths.schedule(normalized, async (signal) => {
    signal.throwIfAborted()
    const entries = await allEntries()
    signal.throwIfAborted()
    const db = await database()
    const transaction = db.transaction(STORE, 'readwrite')
    const removed = entries.filter(
      (entry) => entry.path === normalized || entry.path.startsWith(`${normalized}/`),
    )
    for (const entry of removed) transaction.objectStore(STORE).delete(entry.path)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Offline removal transaction aborted'))
    })
    await Promise.all(removed.map(removePhysicalFile))
    await refreshCatalog()
    retrySources.delete(downloadKey(scope, normalized))
    publishOfflineJob({ state: 'removed', scope, name, path: normalized })
  })
}

export async function removeWebOfflineAndWait(
  path: string,
  name: string,
  scope: OfflineJobScope = 'owner',
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const run = scheduleWebOfflineRemoval(path, name, scope)
  if (!run) throw new Error('Offline mode requires HTTPS or localhost')
  const cancel = () => run.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await run.completion
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export function removeWebOffline(
  path: string,
  name: string,
  scope: OfflineJobScope = 'owner',
): boolean {
  const run = scheduleWebOfflineRemoval(path, name, scope)
  if (!run) return false
  void run.completion.catch(() => undefined)
  return true
}
