import type { FileItem } from '@/lib/types'
import { generateOfflineThumbnail } from './offline-thumbnail'

const DATABASE = 'derp-offline-v1'
const STORE = 'entries'

type StoredOfflineEntry = {
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
}

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

function announce(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('derp-offline-status', { detail }))
}

async function refreshCatalog() {
  window.__DERP_WEB_OFFLINE_PATHS__ = (await allEntries()).map((entry) => entry.path)
  window.dispatchEvent(new Event('derp-offline-catalog'))
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
}

const activeDownloads = new Map<string, AbortController>()
const retrySources = new Map<string, DownloadSource>()

export function cancelWebOffline(path: string) {
  activeDownloads.get(path)?.abort()
}

export function retryWebOffline(path: string) {
  const source = retrySources.get(path)
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
  if (item.isDirectory) {
    await put({
      path: displayPath,
      name: item.name,
      type: 'folder',
      size: 0,
      extension: '',
      isDirectory: true,
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

  const mediaUrl = new URL(
    apiPath.split('/').map(encodeURIComponent).join('/'),
    source.mediaBaseUrl,
  )
  const response = await fetch(mediaUrl, { credentials: 'include', signal })
  if (!response.ok)
    throw Object.assign(new Error(`Could not download ${displayPath}`), { status: response.status })
  const totalBytes = Number(response.headers.get('content-length')) || item.size || 0
  announce({
    state: 'running',
    name: item.name,
    path: displayPath,
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
        announce({
          state: 'running',
          name: item.name,
          path: displayPath,
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
  })
  progress.written.push(displayPath)
  progress.completed += 1
  announce({
    state: 'running',
    name: source.item.name,
    path: displayPath,
    completed: progress.completed,
  })
}

export function saveForWebOffline(source: DownloadSource): boolean {
  if (!webOfflineSupported()) return false
  announce({
    state: 'queued',
    name: source.item.name,
    path: source.displayPath,
    totalBytes: source.item.size || 0,
  })
  retrySources.set(source.displayPath, source)
  const controller = new AbortController()
  activeDownloads.get(source.displayPath)?.abort()
  activeDownloads.set(source.displayPath, controller)
  const progress = { completed: 0, written: [] as string[], physicalFiles: [] as string[] }
  void requireActiveServiceWorker()
    .then(() => saveSource(source, progress, controller.signal))
    .then(async () => {
      const saved = await allEntries()
      if (!saved.some((entry) => entry.path === source.displayPath)) {
        throw new Error('Offline data could not be read back')
      }
      await refreshCatalog()
      announce({ state: 'succeeded', name: source.item.name, path: source.displayPath })
      activeDownloads.delete(source.displayPath)
    })
    .catch(async (error: unknown) => {
      const writtenEntries = (await allEntries()).filter((entry) =>
        progress.written.includes(entry.path),
      )
      const db = await database()
      const transaction = db.transaction(STORE, 'readwrite')
      for (const entry of writtenEntries) {
        transaction.objectStore(STORE).delete(entry.path)
      }
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve()
      })
      await Promise.all(writtenEntries.map(removePhysicalFile))
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory().catch(() => null)
        await Promise.all(
          progress.physicalFiles.map((name) => root?.removeEntry(name).catch(() => undefined)),
        )
      }
      await refreshCatalog()
      const status = (error as { status?: number }).status
      const errorKind =
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'quota'
          : status === 401 || status === 403
            ? 'auth'
            : error instanceof DOMException && error.name === 'AbortError'
              ? 'cancelled'
              : error instanceof TypeError
                ? 'network'
                : 'unsupported-format'
      activeDownloads.delete(source.displayPath)
      announce({
        state: errorKind === 'cancelled' ? 'cancelled' : 'failed',
        name: source.item.name,
        path: source.displayPath,
        errorKind,
        message: error instanceof Error ? error.message : 'Offline download failed',
      })
    })
  return true
}

export function removeWebOffline(path: string, name: string): boolean {
  if (!webOfflineSupported()) return false
  const normalized = path.replace(/^\/+|\/+$/g, '')
  void allEntries().then(async (entries) => {
    const db = await database()
    const transaction = db.transaction(STORE, 'readwrite')
    const removed = entries.filter(
      (entry) => entry.path === normalized || entry.path.startsWith(`${normalized}/`),
    )
    for (const entry of removed) transaction.objectStore(STORE).delete(entry.path)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    await Promise.all(removed.map(removePhysicalFile))
    await refreshCatalog()
    announce({ state: 'removed', name, path: normalized })
  })
  return true
}
