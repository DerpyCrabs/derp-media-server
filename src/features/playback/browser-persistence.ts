import type { PlaybackPersistence } from './types'

export const OWNER_PLAYBACK_STORAGE_KEY = 'derp-playback-session-owner-v2'

export interface PlaybackStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type BrowserPlaybackPersistenceOptions = Readonly<{
  key?: string
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

function readEnvelope(storage: PlaybackStorage | null, key: string): unknown {
  const value = readJson(storage, key)
  if (!value || typeof value !== 'object') return null
  const envelope = value as { state?: unknown; version?: unknown }
  return envelope.version === 2 && 'state' in envelope ? (envelope.state ?? null) : null
}

export function createBrowserPlaybackPersistence(
  options: BrowserPlaybackPersistenceOptions = {},
): PlaybackPersistence {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const key = options.key ?? OWNER_PLAYBACK_STORAGE_KEY

  return {
    load() {
      return readEnvelope(storage, key)
    },
    save(state) {
      if (!storage) return
      storage.setItem(key, JSON.stringify({ state, version: 2 }))
    },
    clear() {
      storage?.removeItem(key)
    },
  }
}
