import { Effect } from 'effect'
import {
  loadSyncedReaderStateEffect,
  saveSyncedReaderStateEffect,
  type ReaderSyncedState,
} from './reader-state-client'

export function createReaderPositionSync<T>(
  path: string,
  normalize: (value: unknown) => T,
  serialize: (position: T) => ReaderSyncedState,
) {
  let revision = 0
  let fingerprint = ''
  const accept = (envelope: {
    revision: number
    fingerprint: string
    state: ReaderSyncedState | null
  }) => {
    revision = envelope.revision
    fingerprint = envelope.fingerprint
    return envelope.state ? normalize(envelope.state) : null
  }
  return {
    load: loadSyncedReaderStateEffect(path).pipe(Effect.map(accept)),
    save: (position: T) =>
      Effect.gen(function* () {
        if (!path || !fingerprint) return null
        const saved = yield* saveSyncedReaderStateEffect(
          path,
          serialize(position),
          revision,
          fingerprint,
        )
        if (saved) {
          revision = saved.revision
          fingerprint = saved.fingerprint
          return null
        }
        const latest = yield* loadSyncedReaderStateEffect(path)
        return accept(latest)
      }),
  }
}
