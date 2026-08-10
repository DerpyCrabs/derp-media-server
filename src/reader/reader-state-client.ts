import { api, ApiError, post } from '@/lib/api'
import {
  clearReaderPosition,
  loadReaderPosition,
  normalizeReaderPosition,
  type ReaderPosition,
} from '@/lib/reader-position'
import type { MediaShareContext } from '../lib/build-media-url'

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

type ReaderPreferences = {
  bookAppearance: BookAppearance
  selectionMode: 'text' | 'image'
  defaultAction: 'define' | 'translate' | 'none'
  aiDetail: ReaderAiDetail
  outlineOpen: boolean
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

const shareRelativePath = (path: string, share: NonNullable<MediaShareContext>) => {
  const normalized = path.replace(/\\/g, '/')
  const base = share.sharePath.replace(/\\/g, '/').replace(/\/$/, '')
  return normalized === base
    ? ''
    : normalized.startsWith(`${base}/`)
      ? normalized.slice(base.length + 1)
      : normalized
}

const stateEndpoint = (share: MediaShareContext) =>
  share ? `/api/share/${encodeURIComponent(share.token)}/reader-state` : '/api/reader-state'

const pendingKey = (path: string, share: MediaShareContext) =>
  `derp.reader.pending.v1:${share ? `share:${share.token}:` : 'admin:'}${path.replace(/\\/g, '/')}`

type ReaderStateSaveResult = { revision: number; fingerprint: string; queued?: boolean } | null
const readerStateSaveQueues = new Map<string, Promise<ReaderStateSaveResult>>()

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

export async function loadSyncedReaderState(
  path: string,
  share: MediaShareContext,
): Promise<ReaderStateEnvelope> {
  const requestPath = share ? shareRelativePath(path, share) : path
  const result = await retryTransient(() =>
    api<ReaderStateEnvelope>(`${stateEndpoint(share)}?path=${encodeURIComponent(requestPath)}`),
  )
  result.state = parseSyncedState(result.state)
  try {
    const pending = JSON.parse(localStorage.getItem(pendingKey(path, share)) ?? 'null') as {
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
    } else if (pending) localStorage.removeItem(pendingKey(path, share))
  } catch {
    localStorage.removeItem(pendingKey(path, share))
  }
  if (!result.state && !share) result.state = loadReaderPosition(path)
  return result
}

async function saveSyncedReaderStateNow(
  path: string,
  share: MediaShareContext,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
): Promise<ReaderStateSaveResult> {
  const requestPath = share ? shareRelativePath(path, share) : path
  try {
    const saved = await retryTransient(() =>
      post<{ revision: number; fingerprint: string }>(stateEndpoint(share), {
        path: requestPath,
        state,
        baseRevision: revision,
        fingerprint,
      }),
    )
    if (!share) clearReaderPosition(path)
    localStorage.removeItem(pendingKey(path, share))
    return saved
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return null
    localStorage.setItem(pendingKey(path, share), JSON.stringify({ state, revision, fingerprint }))
    return { revision, fingerprint, queued: true }
  }
}

export function saveSyncedReaderState(
  path: string,
  share: MediaShareContext,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
): Promise<ReaderStateSaveResult> {
  const key = pendingKey(path, share)
  const previous = readerStateSaveQueues.get(key)
  const queued = (async () => {
    const prior = await previous?.catch(() => null)
    const effectiveRevision =
      prior && !prior.queued && prior.fingerprint === fingerprint ? prior.revision : revision
    return saveSyncedReaderStateNow(path, share, state, effectiveRevision, fingerprint)
  })()
  readerStateSaveQueues.set(key, queued)
  const cleanup = () => {
    if (readerStateSaveQueues.get(key) === queued) readerStateSaveQueues.delete(key)
  }
  void queued.then(cleanup, cleanup)
  return queued
}

const SHARE_PREFERENCES_KEY = 'derp.reader.share-preferences.v1'

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

export async function loadReaderPreferences(share: MediaShareContext): Promise<ReaderPreferences> {
  if (share) {
    try {
      return parsePreferences(JSON.parse(localStorage.getItem(SHARE_PREFERENCES_KEY) ?? 'null'))
    } catch {
      return { ...DEFAULT_READER_PREFERENCES }
    }
  }
  const result = await api<{ preferences: unknown }>('/api/reader-preferences')
  return parsePreferences(result.preferences)
}

export async function saveReaderPreferences(
  share: MediaShareContext,
  preferences: ReaderPreferences,
): Promise<void> {
  if (share) {
    localStorage.setItem(SHARE_PREFERENCES_KEY, JSON.stringify(preferences))
    return
  }
  await post('/api/reader-preferences', { preferences })
}
