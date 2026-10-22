import { Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { readPersistedState, writePersistedState } from '@/lib/state/client-store-utils'

const STORAGE_KEY = 'video-playback-times'

interface VideoPlaybackTimes {
  [filePath: string]: number
}

const persistedTimesSchema = Schema.Struct({
  playbackTimes: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
})

function loadTimes(): VideoPlaybackTimes {
  return readPersistedState(STORAGE_KEY, persistedTimesSchema)?.playbackTimes ?? {}
}

const owner = modelOwner({ playbackTimes: loadTimes() })

function persist(playbackTimes: VideoPlaybackTimes) {
  writePersistedState(STORAGE_KEY, { playbackTimes: { ...playbackTimes } })
}

function getSavedTime(filePath: string): number | null {
  return owner.read().playbackTimes[filePath] ?? null
}

function saveTime(filePath: string, time: number, duration: number) {
  const next = { ...owner.read().playbackTimes }
  if (duration > 0 && time >= duration * 0.9) {
    delete next[filePath]
  } else {
    next[filePath] = time
  }
  owner.patch({ playbackTimes: next })
  persist(next)
}

function clearTime(filePath: string) {
  const next = { ...owner.read().playbackTimes }
  delete next[filePath]
  owner.patch({ playbackTimes: next })
  persist(next)
}

export const videoPlaybackProgress = Object.freeze({
  source: owner.source,
  read: owner.read,
  getSavedTime,
  saveTime,
  clearTime,
})
