import { createMemo, type Accessor } from 'solid-js'
import { createAsyncValue } from './create-async-value'
import {
  loadSyncedReaderState,
  saveSyncedReaderState,
  type ReaderSyncedState,
} from './reader-state-client'

type PositionEnvelope<T> = {
  position: T | null
  revision: number
  fingerprint: string
}

export type ReaderPositionSync<T> = {
  loaded: Accessor<T | null | undefined>
  ready: Accessor<boolean>
  save: (position: T) => Promise<T | null>
}

export function createReaderPositionSync<T>(
  path: Accessor<string>,
  normalize: (value: unknown) => T,
  serialize: (position: T) => ReaderSyncedState,
): ReaderPositionSync<T> {
  const remote = createAsyncValue(path, async (activePath): Promise<PositionEnvelope<T>> => {
    const envelope = await loadSyncedReaderState(activePath)
    return {
      position: envelope.state ? normalize(envelope.state) : null,
      revision: envelope.revision,
      fingerprint: envelope.fingerprint,
    }
  })
  let revision = 0
  let fingerprint = ''
  const loaded = createMemo(() => {
    const envelope = remote.value()
    if (!envelope) return undefined
    revision = envelope.revision
    fingerprint = envelope.fingerprint
    return envelope.position
  })

  return {
    loaded,
    ready: () => !remote.loading() && remote.value() !== undefined,
    save: async (position) => {
      const activePath = path()
      loaded()
      if (!activePath || !fingerprint) return null
      let saved: Awaited<ReturnType<typeof saveSyncedReaderState>>
      try {
        saved = await saveSyncedReaderState(activePath, serialize(position), revision, fingerprint)
      } catch {
        return null
      }
      if (path() !== activePath) return null
      if (saved) {
        revision = saved.revision
        fingerprint = saved.fingerprint
        return null
      }
      const latest = await loadSyncedReaderState(activePath).catch(() => null)
      if (!latest || path() !== activePath) return null
      revision = latest.revision
      fingerprint = latest.fingerprint
      return latest.state ? normalize(latest.state) : null
    },
  }
}
