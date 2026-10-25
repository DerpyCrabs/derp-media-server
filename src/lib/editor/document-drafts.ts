import { randomId } from '@/lib/random-id'

export type DraftKind = 'text' | 'image' | 'pdf' | 'reader-note'
export type DocumentDraft = {
  kind?: DraftKind
  attachment?: Blob
  id: string
  path: string
  content: string
  version: string
  updatedAt: number
}
let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('derp-editor-drafts', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('text', { keyPath: 'id' })
      store.createIndex('path', 'path')
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        database = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => {
      database = undefined
      reject(request.error ?? new Error('Could not open draft storage.'))
    }
    request.onblocked = () => {
      database = undefined
      reject(new Error('Draft storage is blocked by another browser tab.'))
    }
  })
  return database
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not store draft.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Draft storage was interrupted.'))
  })
}
function isDraft(value: unknown): value is DocumentDraft {
  if (!value || typeof value !== 'object') return false
  return (
    (!('kind' in value) ||
      value.kind === 'text' ||
      value.kind === 'image' ||
      value.kind === 'pdf' ||
      value.kind === 'reader-note') &&
    'id' in value &&
    typeof value.id === 'string' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'content' in value &&
    typeof value.content === 'string' &&
    'version' in value &&
    typeof value.version === 'string' &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'number'
  )
}
export async function findDocumentDrafts(
  path: string,
  kind: DraftKind = 'text',
): Promise<DocumentDraft[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('text', 'readonly')
      .objectStore('text')
      .index('path')
      .getAll(path)
    request.onsuccess = () =>
      resolve(
        (request.result as unknown[])
          .filter(isDraft)
          .filter((draft) => (draft.kind ?? 'text') === kind)
          .sort((a, b) => b.updatedAt - a.updatedAt),
      )
    request.onerror = () => reject(request.error)
  })
}
export async function removeDocumentDraft(draft: DocumentDraft): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction('text', 'readwrite'),
    store = tx.objectStore('text')
  const done = complete(tx)
  const request = store.get(draft.id)
  request.onsuccess = () => {
    const current: unknown = request.result
    if (
      isDraft(current) &&
      current.updatedAt === draft.updatedAt &&
      current.content === draft.content &&
      current.version === draft.version &&
      current.kind === draft.kind
    )
      store.delete(draft.id)
  }
  await done
}
export function createDocumentDraftWriter(path: string, kind: DraftKind = 'text') {
  const id = randomId()
  let queued = Promise.resolve()
  let latest: DocumentDraft | undefined
  let failed = false
  const enqueue = (content: string | null, version: string, attachment?: Blob): Promise<void> => {
    if (!failed && content === null && !latest) return queued
    if (!failed && content !== null && latest?.content === content && latest.version === version)
      return queued
    const next =
      content === null
        ? undefined
        : { id, path, kind, content, version, attachment, updatedAt: Date.now() }
    latest = next
    failed = false
    queued = queued
      .catch(() => undefined)
      .then(async () => {
        const db = await openDatabase(),
          tx = db.transaction('text', 'readwrite')
        const done = complete(tx)
        if (next) tx.objectStore('text').put(next)
        else tx.objectStore('text').delete(id)
        await done
      })
      .catch((error: unknown) => {
        if (latest === next) failed = true
        throw error
      })
    return queued
  }
  return { id, write: enqueue, flush: () => queued }
}
