import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { createPlaybackSession } from '@/features/playback/playback-session'
import type { WorkspaceSession } from '@/workspace/shared/WorkspaceSession'
import {
  workspacePlaybackSource,
  workspacePresentationSource,
  workspaceDocumentSource,
} from '@/workspace/shared/workspace-presentation-sources'

test('workspace playback ignores progress but publishes icon and viewer changes', () => {
  const session = createPlaybackSession({
    sourceResolver: { resolve: () => Effect.succeed({ kind: 'resolved', url: '/song.mp3' }) },
  })
  const owner = modelOwner(session.getSnapshot())
  const source = workspacePlaybackSource(owner.source)
  const seen: ReturnType<typeof source.model>[] = []
  const stop = source.subscribe((value) => seen.push(value))
  for (let position = 1; position <= 1000; position++) {
    owner.patch({ position, duration: 2000, buffering: position % 2 === 0, volume: 0.5 })
  }
  expect(seen).toHaveLength(0)
  owner.patch({ currentItem: { locator: 'song.mp3', name: 'song', media: 'audio' } })
  owner.patch({ phase: 'playing' })
  owner.patch({ phase: 'paused' })
  owner.patch({ mode: 'video' })
  owner.patch({ currentItem: { locator: 'song.mp3', name: 'video', media: 'video' } })
  owner.patch({ currentItem: null })
  expect(seen).toHaveLength(6)
  expect(seen[1]).toMatchObject({ path: 'song.mp3', playing: true })
  expect(seen[2]).toMatchObject({ playing: false })
  expect(seen[4]).toMatchObject({ media: 'video', mode: 'video' })
  stop()
  owner.patch({ phase: 'playing' })
  expect(seen).toHaveLength(6)
  owner.dispose()
  session.dispatch({ type: 'destroy' })
})

test('save status remains observable without invalidating workspace content', () => {
  type Snapshot = ReturnType<WorkspaceSession['source']['model']>
  const owner = modelOwner<Snapshot>({
    registry: { version: 1, order: [], records: {} },
    active: { id: 'one', phase: 'open', document: null, revision: 1, editable: true },
    ready: true,
    saving: false,
    saveError: null,
  })
  const source = workspacePresentationSource(owner.source)
  const documentSource = workspaceDocumentSource(owner.source)
  let documentUpdates = 0
  const stopDocument = documentSource.subscribe(() => documentUpdates++)
  let renders = 0
  let statusUpdates = 0
  const stop = source.subscribe(() => renders++)
  const stopStatus = owner.source.subscribe(() => statusUpdates++)
  owner.patch({ saving: true })
  owner.patch({ active: { ...owner.read().active, revision: 2 } })
  owner.patch({
    saving: false,
    saveError: { workspaceId: 'one', message: 'offline', retryable: true, takeover: false },
  })
  expect(renders).toBe(0)
  expect(statusUpdates).toBe(3)
  expect(owner.read().saveError?.message).toBe('offline')
  owner.patch({ active: { ...owner.read().active, editable: false } })
  owner.patch({ active: { ...owner.read().active, phase: 'opening', id: 'two' } })
  owner.patch({
    active: {
      ...owner.read().active,
      document: {
        workspaceType: 'canvas',
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 1,
      },
    },
  })
  owner.patch({ registry: { ...owner.read().registry, order: ['two'] } })
  owner.patch({ ready: false })
  expect(renders).toBe(5)
  expect(documentUpdates).toBe(4)
  stopDocument()
  stop()
  stopStatus()
  owner.patch({ ready: true })
  expect(renders).toBe(5)
  owner.dispose()
})
