import { api, ApiError, post } from '@/lib/api'
import {
  clearReaderPosition,
  loadReaderPosition,
  normalizeReaderPosition,
  type ReaderPosition,
} from '@/lib/reader-position'

export type BookAppearance = {
  fontFamily: 'publisher' | 'serif' | 'sans'
  fontScale: number | null
  lineHeight: number | null
  contentWidth: number | null
  theme: 'publisher' | 'light' | 'dark' | 'sepia'
}

export type ReaderAiDetail = 'compact' | 'detailed'

export const DEFAULT_BOOK_APPEARANCE: BookAppearance = {
  fontFamily: 'publisher',
  fontScale: null,
  lineHeight: null,
  contentWidth: null,
  theme: 'publisher',
}

export type ReaderSyncedState = ReaderPosition & {
  chapterId?: string
  anchor?: string
  progress?: number
  chapterProgress?: number
  outlineExpanded?: string[]
}

export type ReaderStateEnvelope = {
  state: ReaderSyncedState | null
  revision: number
  fingerprint: string
}

export type ReaderPreferences = {
  bookAppearance: BookAppearance
  selectionMode: 'text' | 'image'
  defaultAction: 'define' | 'translate' | 'none'
  aiDetail: ReaderAiDetail
  outlineOpen: boolean
}

export type ReaderPreferencesEnvelope = {
  preferences: ReaderPreferences
  revision: number
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  bookAppearance: DEFAULT_BOOK_APPEARANCE,
  selectionMode: 'text',
  defaultAction: 'define',
  aiDetail: 'compact',
  outlineOpen: true,
}

const finiteInRange = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function parseSyncedState(value: unknown): ReaderSyncedState | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<ReaderSyncedState>
  return {
    ...normalizeReaderPosition(input),
    chapterId: typeof input.chapterId === 'string' ? input.chapterId.slice(0, 1_024) : undefined,
    anchor: typeof input.anchor === 'string' ? input.anchor.slice(0, 1_024) : undefined,
    progress: finiteInRange(input.progress, 0, 1, 0),
    chapterProgress: finiteInRange(input.chapterProgress, 0, 1, 0),
    outlineExpanded: Array.isArray(input.outlineExpanded)
      ? input.outlineExpanded
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 2_000)
      : [],
  }
}

const stateEndpoint = '/api/reader-state'

const pendingKey = (path: string) => `derp.reader.pending.v1:admin:${path.replace(/\\/g, '/')}`

type ReaderStateSaveResult = { revision: number; fingerprint: string; queued?: boolean } | null
const readerStateSaveQueues = new Map<string, Promise<ReaderStateSaveResult>>()
let readerStateSaveSequence = 0

type PendingReaderState = {
  state: ReaderSyncedState
  revision: number
  fingerprint: string
  saveId?: number
}

const writePendingState = (
  path: string,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
  saveId: number,
  currentOnly = false,
) => {
  try {
    if (currentOnly) {
      const pending = JSON.parse(
        localStorage.getItem(pendingKey(path)) ?? 'null',
      ) as PendingReaderState | null
      if (pending?.saveId !== saveId) return
    }
    localStorage.setItem(
      pendingKey(path),
      JSON.stringify({ state, revision, fingerprint, saveId } satisfies PendingReaderState),
    )
  } catch {}
}

const removePendingState = (path: string, saveId: number) => {
  const key = pendingKey(path)
  try {
    const pending = JSON.parse(localStorage.getItem(key) ?? 'null') as PendingReaderState | null
    if (!pending || pending.saveId === saveId) localStorage.removeItem(key)
  } catch {
    localStorage.removeItem(key)
  }
}

const retryTransient = async <T>(request: () => Promise<T>): Promise<T> => {
  let failure: unknown
  for (const delay of [0, 100, 300, 750]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await request()
    } catch (error) {
      failure = error
      if (error instanceof ApiError && error.status < 500) throw error
    }
  }
  throw failure
}

export async function loadSyncedReaderState(path: string): Promise<ReaderStateEnvelope> {
  const result = await retryTransient(() =>
    api<ReaderStateEnvelope>(`${stateEndpoint}?path=${encodeURIComponent(path)}`),
  )
  result.state = parseSyncedState(result.state)
  try {
    const pending = JSON.parse(localStorage.getItem(pendingKey(path)) ?? 'null') as {
      state: ReaderSyncedState
      revision: number
      fingerprint: string
    } | null
    if (
      pending &&
      pending.revision === result.revision &&
      pending.fingerprint === result.fingerprint
    ) {
      result.state = parseSyncedState(pending.state)
    } else if (pending) localStorage.removeItem(pendingKey(path))
  } catch {
    localStorage.removeItem(pendingKey(path))
  }
  if (!result.state) result.state = loadReaderPosition(path)
  return result
}

async function saveSyncedReaderStateNow(
  path: string,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
  saveId: number,
): Promise<ReaderStateSaveResult> {
  try {
    const saved = await retryTransient(() =>
      post<{ revision: number; fingerprint: string }>(stateEndpoint, {
        path,
        state,
        baseRevision: revision,
        fingerprint,
      }),
    )
    clearReaderPosition(path)
    removePendingState(path, saveId)
    return saved
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      removePendingState(path, saveId)
      return null
    }
    writePendingState(path, state, revision, fingerprint, saveId, true)
    return { revision, fingerprint, queued: true }
  }
}

export function saveSyncedReaderState(
  path: string,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
): Promise<ReaderStateSaveResult> {
  const key = pendingKey(path)
  const saveId = ++readerStateSaveSequence
  writePendingState(path, state, revision, fingerprint, saveId)
  const previous = readerStateSaveQueues.get(key)
  const queued = (async () => {
    const prior = await previous?.catch(() => null)
    const effectiveRevision =
      prior && !prior.queued && prior.fingerprint === fingerprint ? prior.revision : revision
    writePendingState(path, state, effectiveRevision, fingerprint, saveId, true)
    return saveSyncedReaderStateNow(path, state, effectiveRevision, fingerprint, saveId)
  })()
  readerStateSaveQueues.set(key, queued)
  const cleanup = () => {
    if (readerStateSaveQueues.get(key) === queued) readerStateSaveQueues.delete(key)
  }
  void queued.then(cleanup, cleanup)
  return queued
}

function parsePreferences(value: unknown): ReaderPreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<ReaderPreferences>
  const appearance = input.bookAppearance ?? DEFAULT_BOOK_APPEARANCE
  return {
    bookAppearance: {
      fontFamily: ['publisher', 'serif', 'sans'].includes(appearance.fontFamily ?? '')
        ? appearance.fontFamily!
        : 'publisher',
      fontScale:
        appearance.fontScale === null ? null : finiteInRange(appearance.fontScale, 0.5, 3, 1),
      lineHeight:
        appearance.lineHeight === null ? null : finiteInRange(appearance.lineHeight, 0.8, 3, 1.65),
      contentWidth:
        appearance.contentWidth === null
          ? null
          : finiteInRange(appearance.contentWidth, 20, 100, 48),
      theme: ['publisher', 'light', 'dark', 'sepia'].includes(appearance.theme ?? '')
        ? appearance.theme!
        : 'publisher',
    },
    selectionMode: input.selectionMode === 'image' ? 'image' : 'text',
    defaultAction: ['define', 'translate', 'none'].includes(input.defaultAction ?? '')
      ? input.defaultAction!
      : 'define',
    aiDetail: input.aiDetail === 'detailed' ? 'detailed' : 'compact',
    outlineOpen: input.outlineOpen !== false,
  }
}

export async function loadReaderPreferences(): Promise<ReaderPreferencesEnvelope> {
  const result = await api<{ preferences: unknown; revision: number }>('/api/reader-preferences')
  return {
    preferences: parsePreferences(result.preferences),
    revision: Number.isFinite(result.revision) ? result.revision : 0,
  }
}

export async function saveReaderPreferences(
  preferences: ReaderPreferences,
  baseRevision: number,
): Promise<number> {
  const result = await post<{ revision: number }>('/api/reader-preferences', {
    preferences,
    baseRevision,
  })
  return result.revision
}

export function mergeReaderPreferenceChanges(
  latest: ReaderPreferences,
  base: ReaderPreferences,
  desired: ReaderPreferences,
): ReaderPreferences {
  const pick = <T>(current: T, original: T, incoming: T) =>
    JSON.stringify(incoming) === JSON.stringify(original) ? current : incoming
  return {
    bookAppearance: {
      fontFamily: pick(
        latest.bookAppearance.fontFamily,
        base.bookAppearance.fontFamily,
        desired.bookAppearance.fontFamily,
      ),
      fontScale: pick(
        latest.bookAppearance.fontScale,
        base.bookAppearance.fontScale,
        desired.bookAppearance.fontScale,
      ),
      lineHeight: pick(
        latest.bookAppearance.lineHeight,
        base.bookAppearance.lineHeight,
        desired.bookAppearance.lineHeight,
      ),
      contentWidth: pick(
        latest.bookAppearance.contentWidth,
        base.bookAppearance.contentWidth,
        desired.bookAppearance.contentWidth,
      ),
      theme: pick(
        latest.bookAppearance.theme,
        base.bookAppearance.theme,
        desired.bookAppearance.theme,
      ),
    },
    selectionMode: pick(latest.selectionMode, base.selectionMode, desired.selectionMode),
    defaultAction: pick(latest.defaultAction, base.defaultAction, desired.defaultAction),
    aiDetail: pick(latest.aiDetail, base.aiDetail, desired.aiDetail),
    outlineOpen: pick(latest.outlineOpen, base.outlineOpen, desired.outlineOpen),
  }
}
