import {
  readerStateEnvelopeSchema,
  readerStateSavedSchema,
  readerRevisionSchema,
  readerPreferencesEnvelopeSchema,
  legacyReaderPreferencesSchema,
} from './reader-schemas'
import { apiSchemaEffect, ApiError, postSchemaEffect } from '@/lib/api/client'
import { Effect, Semaphore } from 'effect'
import { normalizeReaderPosition } from './reader-position'

export type BookAppearance = {
  fontFamily: 'publisher' | 'serif' | 'sans'
  fontScale: number | null
  lineHeight: number | null
  contentWidth: 'narrow' | 'wide' | 'full'
  theme: 'publisher' | 'light' | 'dark' | 'sepia'
}

export type ReaderAiDetail = 'compact' | 'detailed'

export const DEFAULT_BOOK_APPEARANCE: BookAppearance = {
  fontFamily: 'publisher',
  fontScale: null,
  lineHeight: null,
  contentWidth: 'full',
  theme: 'publisher',
}

export type ReaderSyncedState = {
  kind?: 'paged' | 'book'
  pageIndex?: number
  scrollTop?: number
  zoom?: number
  viewMode?: 'continuous' | 'page'
  fitMode?: 'manual' | 'width' | 'height'
  selectionMode?: 'text' | 'image'
  defaultAction?: 'define' | 'translate' | 'none'
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

export type ReaderPreferencesEnvelope = { preferences: ReaderPreferences; revision: number }

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
  const paged = normalizeReaderPosition(input)
  return {
    kind: input.kind === 'book' ? 'book' : input.kind === 'paged' ? 'paged' : undefined,
    pageIndex: paged.pageIndex,
    scrollTop: paged.scrollTop,
    zoom: paged.zoom,
    viewMode: paged.viewMode,
    fitMode: paged.fitMode,
    selectionMode: input.selectionMode === 'image' ? 'image' : undefined,
    defaultAction:
      input.defaultAction === 'translate' || input.defaultAction === 'none'
        ? input.defaultAction
        : undefined,
    chapterId: typeof input.chapterId === 'string' ? input.chapterId.slice(0, 1_024) : undefined,
    anchor: typeof input.anchor === 'string' ? input.anchor.slice(0, 1_024) : undefined,
    progress: input.progress == null ? undefined : finiteInRange(input.progress, 0, 1, 0),
    chapterProgress: finiteInRange(input.chapterProgress, 0, 1, 0),
    outlineExpanded: Array.isArray(input.outlineExpanded)
      ? input.outlineExpanded
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 2_000)
      : [],
  }
}

const stateEndpoint = '/api/reader-state'

type ReaderStateSaveResult = { revision: number; fingerprint: string } | null
const readerStateSaveQueues = new Map<
  string,
  { gate: Semaphore.Semaphore; pending: number; previous: ReaderStateSaveResult }
>()

const retryTransient = <T>(request: Effect.Effect<T, Error>) => {
  const attempt = (index: number): Effect.Effect<T, Error> =>
    request.pipe(
      Effect.catch((error) => {
        if (index >= 3 || (error instanceof ApiError && error.status < 500))
          return Effect.fail(error)
        return Effect.sleep([100, 300, 750][index]!).pipe(Effect.andThen(attempt(index + 1)))
      }),
    )
  return attempt(0)
}

export const loadSyncedReaderStateEffect = (path: string) =>
  retryTransient(
    apiSchemaEffect(readerStateEnvelopeSchema, `${stateEndpoint}?path=${encodeURIComponent(path)}`),
  ).pipe(Effect.map((result) => ({ ...result, state: parseSyncedState(result.state) })))

const saveSyncedReaderStateNow = (
  path: string,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
): Effect.Effect<ReaderStateSaveResult, Error> =>
  retryTransient(
    postSchemaEffect(readerStateSavedSchema, stateEndpoint, {
      path,
      state,
      baseRevision: revision,
      fingerprint,
    }),
  ).pipe(
    Effect.catch((error) =>
      error instanceof ApiError && error.status === 409 ? Effect.succeed(null) : Effect.fail(error),
    ),
  )

export const saveSyncedReaderStateEffect = (
  path: string,
  state: ReaderSyncedState,
  revision: number,
  fingerprint: string,
) =>
  Effect.suspend(() => {
    const key = path.replace(/\\/g, '/')
    let queue = readerStateSaveQueues.get(key)
    if (!queue) {
      queue = { gate: Semaphore.makeUnsafe(1), pending: 0, previous: null }
      readerStateSaveQueues.set(key, queue)
    }
    const current = queue
    current.pending++
    return current.gate
      .withPermits(1)(
        Effect.suspend(() => {
          const prior = current.previous
          const effectiveRevision =
            prior && prior.fingerprint === fingerprint ? prior.revision : revision
          return saveSyncedReaderStateNow(path, state, effectiveRevision, fingerprint).pipe(
            Effect.tap((saved) =>
              Effect.sync(() => {
                current.previous = saved
              }),
            ),
            Effect.tapError(() =>
              Effect.sync(() => {
                current.previous = null
              }),
            ),
          )
        }),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (--current.pending === 0) readerStateSaveQueues.delete(key)
          }),
        ),
      )
  })

function parsePreferences(input: typeof legacyReaderPreferencesSchema.Type): ReaderPreferences {
  const appearance = input.bookAppearance ?? DEFAULT_BOOK_APPEARANCE
  const contentWidth = appearance.contentWidth
  return {
    bookAppearance: {
      fontFamily:
        appearance.fontFamily === 'serif' || appearance.fontFamily === 'sans'
          ? appearance.fontFamily
          : 'publisher',
      fontScale:
        appearance.fontScale === null ? null : finiteInRange(appearance.fontScale, 0.5, 3, 1),
      lineHeight:
        appearance.lineHeight === null ? null : finiteInRange(appearance.lineHeight, 0.8, 3, 1.65),
      contentWidth:
        contentWidth === 'narrow' || contentWidth === 48
          ? 'narrow'
          : contentWidth === 'wide' || contentWidth === 64
            ? 'wide'
            : 'full',
      theme:
        appearance.theme === 'light' || appearance.theme === 'dark' || appearance.theme === 'sepia'
          ? appearance.theme
          : 'publisher',
    },
    selectionMode: input.selectionMode === 'image' ? 'image' : 'text',
    defaultAction:
      input.defaultAction === 'translate' || input.defaultAction === 'none'
        ? input.defaultAction
        : 'define',
    aiDetail: input.aiDetail === 'detailed' ? 'detailed' : 'compact',
    outlineOpen: input.outlineOpen !== false,
  }
}

export const loadReaderPreferencesEffect = apiSchemaEffect(
  readerPreferencesEnvelopeSchema,
  '/api/reader-preferences',
).pipe(
  Effect.map((result): ReaderPreferencesEnvelope => ({
    preferences: parsePreferences(result.preferences),
    revision: Number.isFinite(result.revision) ? result.revision : 0,
  })),
)

export const saveReaderPreferencesEffect = (preferences: ReaderPreferences, baseRevision: number) =>
  postSchemaEffect(readerRevisionSchema, '/api/reader-preferences', {
    preferences,
    baseRevision,
  }).pipe(Effect.map((result) => result.revision))

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
