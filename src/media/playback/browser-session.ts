import {
  OWNER_PLAYBACK_STORAGE_KEY,
  createBrowserPlaybackPersistence,
  createPlaybackSession,
  type PlaybackPersistence,
  type PlaybackSession,
} from '@/lib/playback-session'
import { grantOpenScope } from '@/src/lib/legacy-resource-adapter'
import {
  createGrantSessionPlaybackSourceAdapter,
  createOwnerPlaybackSourceAdapter,
  type GrantSessionPlaybackSourceAdapterOptions,
  type OwnerPlaybackSourceAdapterOptions,
} from './source-adapters'

type BrowserSessionOptions = Readonly<{
  initialOnline?: boolean
  persistence?: PlaybackPersistence
}>

export type OwnerBrowserPlaybackSessionOptions = OwnerPlaybackSourceAdapterOptions &
  BrowserSessionOptions

export type GrantBrowserPlaybackSessionOptions = GrantSessionPlaybackSourceAdapterOptions &
  BrowserSessionOptions

function browserOnline(initialOnline: boolean | undefined): boolean {
  if (initialOnline !== undefined) return initialOnline
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

export function createOwnerBrowserPlaybackSession(
  options: OwnerBrowserPlaybackSessionOptions = {},
): PlaybackSession {
  return createPlaybackSession({
    scope: { kind: 'owner' },
    sourceAdapter: createOwnerPlaybackSourceAdapter(options),
    persistence:
      options.persistence ?? createBrowserPlaybackPersistence(OWNER_PLAYBACK_STORAGE_KEY),
    initialOnline: browserOnline(options.initialOnline),
  })
}

export function grantPlaybackSessionId(token: string): string {
  const scope = grantOpenScope(token)
  if (scope.kind !== 'grant') throw new Error('Grant scope could not be created')
  return scope.id
}

export function grantPlaybackStorageKey(id: string): string {
  return `${OWNER_PLAYBACK_STORAGE_KEY}:grant:${encodeURIComponent(id)}`
}

export function createGrantBrowserPlaybackSession(
  options: GrantBrowserPlaybackSessionOptions,
): PlaybackSession {
  const id = options.id ?? grantPlaybackSessionId(options.token)
  const storageKey = grantPlaybackStorageKey(id)
  return createPlaybackSession({
    scope: { kind: 'grantSession', id },
    sourceAdapter: createGrantSessionPlaybackSourceAdapter({ ...options, id }),
    // Grant continuity is isolated by opaque session id. The separate legacy key
    // prevents shared progress from entering owner path-keyed playback history.
    persistence:
      options.persistence ??
      createBrowserPlaybackPersistence(storageKey, `${storageKey}:legacy-progress`),
    initialOnline: browserOnline(options.initialOnline),
  })
}

export const createGrantSessionBrowserPlaybackSession = createGrantBrowserPlaybackSession
