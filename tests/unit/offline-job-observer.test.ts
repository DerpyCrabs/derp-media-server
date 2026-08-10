import { describe, expect, test } from 'bun:test'
import {
  OFFLINE_JOB_EVENT,
  createOfflineJobObserver,
  shareOfflineJobScope,
  type OfflineJobUpdate,
} from '@/src/lib/offline-job-observer'

function harness() {
  const events = new EventTarget()
  const observer = createOfflineJobObserver(events)
  const publish = (detail: OfflineJobUpdate) => {
    events.dispatchEvent(new CustomEvent(OFFLINE_JOB_EVENT, { detail }))
  }
  return { observer, publish }
}

describe('offline job observer interface', () => {
  test('retains jobs across subscriber lifecycles and publishes current state immediately', () => {
    const { observer, publish } = harness()
    publish({ state: 'queued', path: 'Movies/demo.mp4', name: 'demo.mp4' })

    const first: string[][] = []
    const unsubscribe = observer.subscribe('owner', (snapshot) => {
      first.push(snapshot.map((job) => job.state))
    })
    unsubscribe()
    publish({ state: 'succeeded', path: 'Movies/demo.mp4', name: 'demo.mp4' })

    const late: string[][] = []
    observer.subscribe('owner', (snapshot) => {
      late.push(snapshot.map((job) => job.state))
    })()

    expect(first).toEqual([['queued']])
    expect(late).toEqual([['succeeded']])
    expect(observer.getSnapshot('owner')[0]?.state).toBe('succeeded')
  })

  test('deduplicates by path, keeps newest update first, and preserves progress fields', () => {
    const { observer, publish } = harness()
    publish({
      state: 'queued',
      path: 'Movies/a.mp4',
      name: 'a.mp4',
      totalBytes: 100,
    })
    publish({ state: 'queued', path: 'Movies/b.mp4', name: 'b.mp4', totalBytes: 200 })
    publish({ state: 'running', path: 'Movies/a.mp4', downloadedBytes: 40 })
    publish({ state: 'running', path: 'Movies/a.mp4', completed: 1 })

    const snapshot = observer.getSnapshot('owner')
    expect(snapshot.map((job) => job.path)).toEqual(['Movies/a.mp4', 'Movies/b.mp4'])
    expect(snapshot[0]).toMatchObject({
      state: 'running',
      name: 'a.mp4',
      downloadedBytes: 40,
      totalBytes: 100,
      completed: 1,
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  test('resets stale progress for a retried queued job', () => {
    const { observer, publish } = harness()
    publish({
      state: 'running',
      path: 'Books/a.epub',
      downloadedBytes: 80,
      totalBytes: 100,
    })
    publish({ state: 'queued', path: 'Books/a.epub', name: 'a.epub' })

    expect(observer.getSnapshot('owner')[0]).toEqual({
      state: 'queued',
      scope: 'owner',
      path: 'Books/a.epub',
      name: 'a.epub',
    })
  })

  test('isolates owner and share metadata while preserving unscoped event compatibility', () => {
    const { observer, publish } = harness()
    const shareScope = shareOfflineJobScope('secret-token')
    publish({ state: 'queued', path: 'owner.txt', name: 'owner.txt' })
    publish({
      state: 'failed',
      scope: shareScope,
      path: 'shared.txt',
      name: 'shared.txt',
      errorKind: 'auth',
    })

    expect(observer.getSnapshot('owner').map((job) => job.path)).toEqual(['owner.txt'])
    expect(observer.getSnapshot(shareScope).map((job) => job.path)).toEqual(['shared.txt'])
  })

  test('bounds retained history per scope', () => {
    const { observer, publish } = harness()
    for (let index = 0; index < 25; index += 1) {
      publish({ state: 'succeeded', path: `file-${index}`, name: `file-${index}` })
    }

    const snapshot = observer.getSnapshot('owner')
    expect(snapshot).toHaveLength(20)
    expect(snapshot[0]?.path).toBe('file-24')
    expect(snapshot[19]?.path).toBe('file-5')
  })
})
