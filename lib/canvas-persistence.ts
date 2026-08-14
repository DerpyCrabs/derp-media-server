import {
  createEmptyCanvasState,
  parseInfiniteCanvasState,
  serializeInfiniteCanvasState,
  type InfiniteCanvasState,
} from './infinite-canvas'
import type { ContentWindowPersistencePort } from './content-window-persistence'

export const CANVAS_DOCUMENT_SCHEMA_VERSION = 2 as const
export const CANVAS_CRASH_DRAFT_SCHEMA_VERSION = 1 as const
export const CANVAS_CRASH_DRAFT_STORAGE_KEY = 'infinite-canvas-crash-draft-v1'
export const DEFAULT_CANVAS_NAME = 'Untitled canvas'

export type PersistedCanvas = {
  id: string
  name: string
  state: InfiniteCanvasState
  updatedAt: number
}

export type CanvasCollection = {
  schemaVersion: typeof CANVAS_DOCUMENT_SCHEMA_VERSION
  revision: number
  activeId: string | null
  canvases: PersistedCanvas[]
}

export type SaveCanvasCollection = Omit<CanvasCollection, 'revision'> & {
  expectedRevision: number
}

export type CanvasCrashDraft = {
  schemaVersion: typeof CANVAS_CRASH_DRAFT_SCHEMA_VERSION
  baseRevision: number
  savedAt: number
  activeId: string | null
  canvases: PersistedCanvas[]
}

export type StoredCanvasInspection<T> =
  | { kind: 'absent' }
  | { kind: 'valid'; raw: string; value: T }
  | { kind: 'corrupt'; raw: string }

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  )
}

function parseCanvasRecord(
  value: unknown,
  persistence: ContentWindowPersistencePort,
): PersistedCanvas | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<PersistedCanvas>
  const state = parseInfiniteCanvasState(raw.state, persistence)
  if (
    !hasOnlyKeys(value, ['id', 'name', 'state', 'updatedAt']) ||
    !validId(raw.id) ||
    typeof raw.name !== 'string' ||
    raw.name.trim().length === 0 ||
    raw.name.length > 120 ||
    !validTimestamp(raw.updatedAt) ||
    !state
  ) {
    return null
  }
  return { id: raw.id, name: raw.name.trim(), state, updatedAt: raw.updatedAt }
}

function parseRecords(
  value: unknown,
  persistence: ContentWindowPersistencePort,
): PersistedCanvas[] | null {
  if (!Array.isArray(value)) return null
  const canvases: PersistedCanvas[] = []
  const ids = new Set<string>()
  for (const item of value) {
    const canvas = parseCanvasRecord(item, persistence)
    if (!canvas || ids.has(canvas.id)) return null
    ids.add(canvas.id)
    canvases.push(canvas)
  }
  return canvases
}

function validActiveId(activeId: unknown, canvases: PersistedCanvas[]): activeId is string | null {
  return canvases.length === 0
    ? activeId === null
    : typeof activeId === 'string' && canvases.some((canvas) => canvas.id === activeId)
}

export function parseCanvasCollection(
  value: unknown,
  persistence: ContentWindowPersistencePort,
): CanvasCollection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<CanvasCollection>
  const canvases = parseRecords(raw.canvases, persistence)
  if (
    !hasOnlyKeys(value, ['schemaVersion', 'revision', 'activeId', 'canvases']) ||
    raw.schemaVersion !== CANVAS_DOCUMENT_SCHEMA_VERSION ||
    !validTimestamp(raw.revision) ||
    !canvases ||
    !validActiveId(raw.activeId, canvases)
  ) {
    return null
  }
  return {
    schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
    revision: raw.revision,
    activeId: raw.activeId,
    canvases,
  }
}

function serializableRecords(
  canvases: PersistedCanvas[],
  persistence: ContentWindowPersistencePort,
): unknown[] {
  return canvases.map((canvas) => ({
    ...canvas,
    state: JSON.parse(serializeInfiniteCanvasState(canvas.state, persistence)) as unknown,
  }))
}

export function serializeCanvasCollection(
  collection: CanvasCollection,
  persistence: ContentWindowPersistencePort,
): string {
  return JSON.stringify({
    ...collection,
    canvases: serializableRecords(collection.canvases, persistence),
  })
}

export function canvasSaveRequest(
  collection: CanvasCollection,
  persistence: ContentWindowPersistencePort,
): SaveCanvasCollection {
  return {
    schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
    expectedRevision: collection.revision,
    activeId: collection.activeId,
    canvases: JSON.parse(
      JSON.stringify(serializableRecords(collection.canvases, persistence)),
    ) as PersistedCanvas[],
  }
}

export function createCanvasRecord(
  name: string,
  state = createEmptyCanvasState(),
  now = Date.now(),
): PersistedCanvas {
  return {
    id: randomId(),
    name: name.trim() || DEFAULT_CANVAS_NAME,
    state,
    updatedAt: now,
  }
}

export function createDefaultCanvasCollection(): CanvasCollection {
  const canvas = createCanvasRecord(DEFAULT_CANVAS_NAME)
  return {
    schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
    revision: 0,
    activeId: canvas.id,
    canvases: [canvas],
  }
}

export function inspectCanvasCrashDraft(
  storage: ReadStorage,
  persistence: ContentWindowPersistencePort,
): StoredCanvasInspection<CanvasCrashDraft> {
  const raw = storage.getItem(CANVAS_CRASH_DRAFT_STORAGE_KEY)
  if (raw === null) return { kind: 'absent' }
  try {
    const value = JSON.parse(raw) as Partial<CanvasCrashDraft>
    const document = parseCanvasCollection(
      {
        schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
        revision: value.baseRevision,
        activeId: value.activeId,
        canvases: value.canvases,
      },
      persistence,
    )
    if (
      !value ||
      !hasOnlyKeys(value, ['schemaVersion', 'baseRevision', 'savedAt', 'activeId', 'canvases']) ||
      value.schemaVersion !== CANVAS_CRASH_DRAFT_SCHEMA_VERSION ||
      !validTimestamp(value.savedAt) ||
      !document ||
      document.canvases.length === 0
    ) {
      return { kind: 'corrupt', raw }
    }
    return {
      kind: 'valid',
      raw,
      value: {
        schemaVersion: CANVAS_CRASH_DRAFT_SCHEMA_VERSION,
        baseRevision: document.revision,
        savedAt: value.savedAt,
        activeId: document.activeId,
        canvases: document.canvases,
      },
    }
  } catch {
    return { kind: 'corrupt', raw }
  }
}

export function writeCanvasCrashDraft(
  storage: WriteStorage,
  collection: CanvasCollection,
  persistence: ContentWindowPersistencePort,
  savedAt = Date.now(),
): void {
  const draft: CanvasCrashDraft = {
    schemaVersion: CANVAS_CRASH_DRAFT_SCHEMA_VERSION,
    baseRevision: collection.revision,
    savedAt,
    activeId: collection.activeId,
    canvases: collection.canvases,
  }
  storage.setItem(
    CANVAS_CRASH_DRAFT_STORAGE_KEY,
    JSON.stringify({
      ...draft,
      canvases: serializableRecords(draft.canvases, persistence),
    }),
  )
}

export function clearCanvasCrashDraft(storage: WriteStorage): void {
  storage.removeItem(CANVAS_CRASH_DRAFT_STORAGE_KEY)
}
