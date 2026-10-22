import { mapSource, type Source } from 'effectweb'
import type { PlaybackSnapshot } from '@/features/playback/types'
import type { WorkspaceSession } from './WorkspaceSession'

export function workspacePresentationSource(source: WorkspaceSession['source']) {
  return mapSource(
    source,
    ({ registry, active, ready }) => ({
      registry,
      ready,
      document: active.document,
      id: active.id,
      phase: active.phase,
      editable: active.editable,
    }),
    (a, b) =>
      a.registry === b.registry &&
      a.ready === b.ready &&
      a.document === b.document &&
      a.id === b.id &&
      a.phase === b.phase &&
      a.editable === b.editable,
  )
}

export function workspacePlaybackSource(source: Source<PlaybackSnapshot>) {
  return mapSource(
    source,
    (snapshot) => ({
      path: snapshot.currentItem?.locator ?? null,
      media: snapshot.currentItem?.media ?? null,
      mode: snapshot.mode,
      playing: snapshot.phase === 'playing',
    }),
    (a, b) =>
      a.path === b.path && a.media === b.media && a.mode === b.mode && a.playing === b.playing,
  )
}

export function workspaceDocumentSource(source: WorkspaceSession['source']) {
  return mapSource(
    source,
    ({ active, ready }) => ({
      ready,
      document: active.document,
      id: active.id,
      phase: active.phase,
      editable: active.editable,
    }),
    (a, b) =>
      a.ready === b.ready &&
      a.document === b.document &&
      a.id === b.id &&
      a.phase === b.phase &&
      a.editable === b.editable,
  )
}
