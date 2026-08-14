import type { PlaybackPersistence } from './types'

export const OWNER_PLAYBACK_STORAGE_KEY = 'derp-playback-session-owner-v1'
export const LEGACY_VIDEO_PROGRESS_STORAGE_KEY = 'video-playback-times'

export interface PlaybackStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type BrowserPlaybackPersistenceOptions = Readonly<{
  key?: string
  legacyProgressKey?: string
  storage?: PlaybackStorage | null
}>

function defaultStorage(): PlaybackStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readJson(storage: PlaybackStorage | null, key: string): unknown {
  if (!storage) return null
  try {
    return JSON.parse(storage.getItem(key) ?? 'null') as unknown
  } catch {
    return null
  }
}

function unwrapState(value: unknown): unknown {
  if (value && typeof value === 'object' && 'state' in value) {
    return (value as { state?: unknown }).state ?? null
  }
  return value
}

export function createBrowserPlaybackPersistence(
  options: BrowserPlaybackPersistenceOptions = {},
): PlaybackPersistence {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const key = options.key ?? OWNER_PLAYBACK_STORAGE_KEY
  const legacyProgressKey = options.legacyProgressKey ?? LEGACY_VIDEO_PROGRESS_STORAGE_KEY

  return {
    load() {
      return unwrapState(readJson(storage, key))
    },
    save(state) {
      if (!storage) return
      storage.setItem(key, JSON.stringify({ state, version: 1 }))
    },
    clear() {
      storage?.removeItem(key)
    },
    legacyPosition(locator) {
      const value = unwrapState(readJson(storage, legacyProgressKey))
      if (!value || typeof value !== 'object' || !('playbackTimes' in value)) return null
      const playbackTimes = (value as { playbackTimes?: unknown }).playbackTimes
      if (!playbackTimes || typeof playbackTimes !== 'object') return null
      const times = playbackTimes as Record<string, unknown>
      const time =
        times[locator] ??
        Object.entries(times).find(
          ([legacyLocator]) => legacyLocator.replace(/\\/g, '/') === locator.replace(/\\/g, '/'),
        )?.[1]
      return typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : null
    },
  }
}
