import {
  CANVAS_STORAGE_KEY,
  createEmptyCanvasState,
  parseInfiniteCanvasState,
  serializeInfiniteCanvasState,
  type InfiniteCanvasState,
} from './infinite-canvas'

export const CANVAS_COLLECTION_STORAGE_KEY = 'infinite-canvases-v1'
export const DEFAULT_CANVAS_NAME = 'Untitled canvas'

export type PersistedCanvas = {
  id: string
  name: string
  state: InfiniteCanvasState | null
  updatedAt: number
  writerId: string
  deleted: boolean
}

export type CanvasCollection = {
  version: 1
  activeId: string
  writerId: string
  lastTimestamp: number
  canvases: PersistedCanvas[]
}

type ReadStorage = Pick<Storage, 'getItem'>

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

export function compareCanvasRecords(a: PersistedCanvas, b: PersistedCanvas): number {
  return a.updatedAt - b.updatedAt || a.writerId.localeCompare(b.writerId)
}

export function parsePersistedCanvas(value: unknown): PersistedCanvas | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<PersistedCanvas>
  if (
    !validId(raw.id) ||
    !validId(raw.writerId) ||
    typeof raw.name !== 'string' ||
    raw.name.trim().length === 0 ||
    raw.name.length > 120 ||
    typeof raw.updatedAt !== 'number' ||
    !Number.isSafeInteger(raw.updatedAt) ||
    raw.updatedAt < 0 ||
    typeof raw.deleted !== 'boolean'
  ) {
    return null
  }
  const state = raw.deleted ? null : parseInfiniteCanvasState(raw.state)
  if (!raw.deleted && !state) return null
  return {
    id: raw.id,
    name: raw.name.trim(),
    state,
    updatedAt: raw.updatedAt,
    writerId: raw.writerId,
    deleted: raw.deleted,
  }
}

export function parseCanvasRecords(value: unknown): PersistedCanvas[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as { canvases?: unknown }).canvases
      : null
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, PersistedCanvas>()
  for (const value of raw) {
    const record = parsePersistedCanvas(value)
    if (!record) continue
    const current = byId.get(record.id)
    if (!current || compareCanvasRecords(record, current) > 0) byId.set(record.id, record)
  }
  return [...byId.values()]
}

export function mergeCanvasRecords(
  local: PersistedCanvas[],
  remote: PersistedCanvas[],
): PersistedCanvas[] {
  return parseCanvasRecords([...local, ...remote]).sort((a, b) =>
    a.deleted === b.deleted
      ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      : a.deleted
        ? 1
        : -1,
  )
}

function newCollection(state: InfiniteCanvasState, now = Date.now()): CanvasCollection {
  const writerId = randomId()
  const id = randomId()
  return {
    version: 1,
    activeId: id,
    writerId,
    lastTimestamp: now,
    canvases: [{ id, name: DEFAULT_CANVAS_NAME, state, updatedAt: now, writerId, deleted: false }],
  }
}

export function loadCanvasCollection(storage: ReadStorage): CanvasCollection {
  try {
    const saved = JSON.parse(
      storage.getItem(CANVAS_COLLECTION_STORAGE_KEY) ?? 'null',
    ) as Partial<CanvasCollection> | null
    if (saved?.version === 1 && validId(saved.writerId)) {
      const canvases = parseCanvasRecords(saved.canvases)
      const active = canvases.find((item) => item.id === saved.activeId && !item.deleted)
      const fallback = canvases.find((item) => !item.deleted)
      if (active || fallback) {
        return {
          version: 1,
          writerId: saved.writerId,
          activeId: (active ?? fallback)!.id,
          lastTimestamp: Math.max(
            Number.isSafeInteger(saved.lastTimestamp) ? saved.lastTimestamp! : 0,
            ...canvases.map((item) => item.updatedAt),
          ),
          canvases,
        }
      }
    }
  } catch {}
  let legacy = createEmptyCanvasState()
  try {
    const raw = storage.getItem(CANVAS_STORAGE_KEY)
    legacy = raw ? (parseInfiniteCanvasState(JSON.parse(raw)) ?? legacy) : legacy
  } catch {}
  return newCollection(legacy)
}

export function nextCanvasTimestamp(collection: CanvasCollection, now = Date.now()): number {
  return Math.max(now, collection.lastTimestamp + 1)
}

export function serializeCanvasCollection(collection: CanvasCollection): string {
  return JSON.stringify({
    ...collection,
    canvases: collection.canvases.map((canvas) =>
      canvas.state
        ? { ...canvas, state: JSON.parse(serializeInfiniteCanvasState(canvas.state)) }
        : canvas,
    ),
  })
}

export function createCanvasRecord(
  collection: CanvasCollection,
  name: string,
  state = createEmptyCanvasState(),
): PersistedCanvas {
  return {
    id: randomId(),
    name: name.trim() || DEFAULT_CANVAS_NAME,
    state,
    updatedAt: nextCanvasTimestamp(collection),
    writerId: collection.writerId,
    deleted: false,
  }
}
