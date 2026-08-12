import {
  CANVAS_STORAGE_KEY,
  createEmptyCanvasState,
  parseInfiniteCanvasState,
  serializeInfiniteCanvasState,
  type InfiniteCanvasState,
} from './infinite-canvas'

export const CANVAS_COLLECTION_STORAGE_KEY = 'infinite-canvases-v1'
export const CANVAS_COLLECTION_SOURCE_BACKUP_KEY = 'space-import-source-infinite-canvases-v1'
export const CANVAS_LEGACY_SOURCE_BACKUP_KEY = 'space-import-source-infinite-canvas-state-v1'
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
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'>
type RemoveStorage = Pick<Storage, 'removeItem'>

export type CanvasStorageSource = {
  key: typeof CANVAS_COLLECTION_STORAGE_KEY | typeof CANVAS_STORAGE_KEY
  backupKey: typeof CANVAS_COLLECTION_SOURCE_BACKUP_KEY | typeof CANVAS_LEGACY_SOURCE_BACKUP_KEY
  raw: string
}

export type CanvasStorageInspection =
  | { kind: 'none'; sources: [] }
  | { kind: 'valid'; sources: CanvasStorageSource[]; collection: CanvasCollection }
  | {
      kind: 'unexpected'
      sources: CanvasStorageSource[]
      recovery: CanvasCollection
      hasRecoverableCanvas: boolean
      message: string
    }

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

export function readCanvasStorageSources(storage: ReadStorage): CanvasStorageSource[] {
  const collection = storage.getItem(CANVAS_COLLECTION_STORAGE_KEY)
  const legacy = storage.getItem(CANVAS_STORAGE_KEY)
  return [
    ...(collection === null
      ? []
      : [
          {
            key: CANVAS_COLLECTION_STORAGE_KEY,
            backupKey: CANVAS_COLLECTION_SOURCE_BACKUP_KEY,
            raw: collection,
          } as const,
        ]),
    ...(legacy === null
      ? []
      : [
          {
            key: CANVAS_STORAGE_KEY,
            backupKey: CANVAS_LEGACY_SOURCE_BACKUP_KEY,
            raw: legacy,
          } as const,
        ]),
  ]
}

/** Copy original bytes once. Later Space-backed Canvas writes must not replace this source copy. */
export function preserveCanvasStorageSources(
  storage: WriteStorage,
  sources = readCanvasStorageSources(storage),
): void {
  for (const source of sources) {
    if (storage.getItem(source.backupKey) === null) storage.setItem(source.backupKey, source.raw)
  }
}

function parseCompleteCanvasState(value: unknown): InfiniteCanvasState | null {
  const parsed = parseInfiniteCanvasState(value)
  if (!parsed || !value || typeof value !== 'object') return null
  const rawWindows = (value as { windows?: unknown }).windows
  if (!Array.isArray(rawWindows) || parsed.windows.length !== rawWindows.length) return null
  for (const rawWindow of rawWindows) {
    if (!rawWindow || typeof rawWindow !== 'object') return null
    const definition = (rawWindow as { definition?: unknown }).definition
    if (!definition || typeof definition !== 'object') return null
    const typedDefinition = definition as { type?: unknown; hermes?: unknown }
    if (typedDefinition.type !== 'hermes') continue
    if (!typedDefinition.hermes || typeof typedDefinition.hermes !== 'object') return null
    if (typeof (typedDefinition.hermes as { sessionId?: unknown }).sessionId !== 'string') {
      return null
    }
  }
  return parsed
}

const CANVAS_SPACE_LOCAL_VERSION = 1

export type CanvasSpaceRecovery = {
  baseRevision: number
  name: string
  state: InfiniteCanvasState
  recoveredSpaceId?: string
}

export type CanvasSpaceRecoveryInspection =
  | { kind: 'missing' }
  | { kind: 'loaded'; recovery: CanvasSpaceRecovery }
  | { kind: 'corrupt'; raw: string }

export function canvasSpaceSessionKey(spaceId: string): string {
  return `space-session-canvas-${encodeURIComponent(spaceId)}`
}

export function canvasSpaceRecoveryKey(spaceId: string): string {
  return `space-recovery-canvas-${encodeURIComponent(spaceId)}`
}

export function persistCanvasSpaceSession(
  storage: Pick<Storage, 'setItem'>,
  storageKey: string,
  state: InfiniteCanvasState,
): void {
  const { camera, maximizedWindowId, windowSizeByType } = state
  storage.setItem(
    storageKey,
    JSON.stringify({
      version: CANVAS_SPACE_LOCAL_VERSION,
      camera,
      maximizedWindowId,
      windowSizeByType,
    }),
  )
}

export function loadCanvasSpaceSession(
  storage: ReadStorage,
  storageKey: string,
): Pick<InfiniteCanvasState, 'camera' | 'maximizedWindowId' | 'windowSizeByType'> | null {
  try {
    const stored = storage.getItem(storageKey)
    if (!stored) return null
    const envelope = JSON.parse(stored) as Partial<InfiniteCanvasState> & { version?: unknown }
    if (envelope.version !== CANVAS_SPACE_LOCAL_VERSION) return null
    const parsed = parseInfiniteCanvasState({
      ...createEmptyCanvasState(),
      camera: envelope.camera,
      maximizedWindowId: null,
      windowSizeByType: envelope.windowSizeByType,
    })
    const maximizedWindowId =
      envelope.maximizedWindowId === null || typeof envelope.maximizedWindowId === 'string'
        ? envelope.maximizedWindowId
        : null
    return parsed
      ? {
          camera: parsed.camera,
          maximizedWindowId,
          windowSizeByType: parsed.windowSizeByType,
        }
      : null
  } catch {
    return null
  }
}

export function persistCanvasSpaceRecovery(
  storage: Pick<Storage, 'setItem'>,
  storageKey: string,
  recovery: Omit<CanvasSpaceRecovery, 'recoveredSpaceId'>,
): void {
  storage.setItem(
    storageKey,
    JSON.stringify({
      version: CANVAS_SPACE_LOCAL_VERSION,
      baseRevision: recovery.baseRevision,
      name: recovery.name,
      raw: serializeInfiniteCanvasState(recovery.state),
    }),
  )
}

export function inspectCanvasSpaceRecovery(
  storage: ReadStorage,
  storageKey: string,
): CanvasSpaceRecoveryInspection {
  const stored = storage.getItem(storageKey)
  if (stored === null) return { kind: 'missing' }
  try {
    const envelope = JSON.parse(stored) as {
      version?: unknown
      baseRevision?: unknown
      name?: unknown
      raw?: unknown
      recoveredSpaceId?: unknown
    }
    if (
      envelope.version !== CANVAS_SPACE_LOCAL_VERSION ||
      !Number.isSafeInteger(envelope.baseRevision) ||
      Number(envelope.baseRevision) < 0 ||
      typeof envelope.name !== 'string' ||
      envelope.name.trim().length === 0 ||
      envelope.name.length > 120 ||
      typeof envelope.raw !== 'string'
    ) {
      return { kind: 'corrupt', raw: stored }
    }
    const state = parseCompleteCanvasState(JSON.parse(envelope.raw))
    if (
      !state ||
      (envelope.recoveredSpaceId !== undefined && !validId(envelope.recoveredSpaceId))
    ) {
      return { kind: 'corrupt', raw: stored }
    }
    return {
      kind: 'loaded',
      recovery: {
        baseRevision: Number(envelope.baseRevision),
        name: envelope.name.trim(),
        state,
        ...(typeof envelope.recoveredSpaceId === 'string'
          ? { recoveredSpaceId: envelope.recoveredSpaceId }
          : {}),
      },
    }
  } catch {
    return { kind: 'corrupt', raw: stored }
  }
}

export function loadCanvasSpaceRecovery(
  storage: ReadStorage,
  storageKey: string,
): CanvasSpaceRecovery | null {
  const inspection = inspectCanvasSpaceRecovery(storage, storageKey)
  return inspection.kind === 'loaded' ? inspection.recovery : null
}

export function clearCanvasSpaceRecovery(storage: RemoveStorage, storageKey: string): void {
  storage.removeItem(storageKey)
}

export function markCanvasSpaceRecoveryCopy(
  storage: WriteStorage,
  storageKey: string,
  recoveredSpaceId: string,
): void {
  const stored = storage.getItem(storageKey)
  if (!stored) return
  const envelope = JSON.parse(stored) as Record<string, unknown>
  if (envelope.version !== CANVAS_SPACE_LOCAL_VERSION || !validId(recoveredSpaceId)) return
  storage.setItem(storageKey, JSON.stringify({ ...envelope, recoveredSpaceId }))
}

function inspectCollectionSource(raw: string): { valid: boolean; recoverable: boolean } {
  try {
    const value = JSON.parse(raw) as Partial<CanvasCollection> | null
    if (!value || typeof value !== 'object' || !Array.isArray(value.canvases)) {
      return { valid: false, recoverable: false }
    }
    const parsedRecords = value.canvases.map(parsePersistedCanvas)
    const recoverable = parsedRecords.some((record) => !!record && !record.deleted)
    if (
      value.version !== 1 ||
      !validId(value.activeId) ||
      !validId(value.writerId) ||
      !Number.isSafeInteger(value.lastTimestamp) ||
      Number(value.lastTimestamp) < 0 ||
      parsedRecords.some((record) => !record) ||
      new Set(parsedRecords.map((record) => record!.id)).size !== parsedRecords.length ||
      !parsedRecords.some((record) => record!.id === value.activeId && !record!.deleted)
    ) {
      return { valid: false, recoverable }
    }
    const complete = value.canvases.every((canvas, index) => {
      const parsed = parsedRecords[index]!
      if (parsed.deleted) return true
      return (
        !!canvas &&
        typeof canvas === 'object' &&
        !!parseCompleteCanvasState((canvas as { state?: unknown }).state)
      )
    })
    return { valid: complete, recoverable }
  } catch {
    return { valid: false, recoverable: false }
  }
}

function inspectLegacySource(raw: string): { valid: boolean; recoverable: boolean } {
  try {
    const state = parseCompleteCanvasState(JSON.parse(raw))
    return { valid: !!state, recoverable: !!state }
  } catch {
    return { valid: false, recoverable: false }
  }
}

export function inspectCanvasStorage(storage: ReadStorage): CanvasStorageInspection {
  const sources = readCanvasStorageSources(storage)
  if (sources.length === 0) return { kind: 'none', sources: [] }
  const collectionSource = sources.find((source) => source.key === CANVAS_COLLECTION_STORAGE_KEY)
  const primary = collectionSource
    ? inspectCollectionSource(collectionSource.raw)
    : inspectLegacySource(sources[0]!.raw)
  if (primary.valid) return { kind: 'valid', sources, collection: loadCanvasCollection(storage) }
  const legacySource = sources.find((source) => source.key === CANVAS_STORAGE_KEY)
  const legacyRecovery = legacySource ? inspectLegacySource(legacySource.raw).recoverable : false
  return {
    kind: 'unexpected',
    sources,
    recovery: loadCanvasCollection(storage),
    hasRecoverableCanvas: primary.recoverable || legacyRecovery,
    message:
      'Saved Canvas data is unreadable or contains records this version cannot safely import.',
  }
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
