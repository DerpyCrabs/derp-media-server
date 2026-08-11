import { describe, expect, test } from 'bun:test'
import { createOwnerPlaybackProgress } from '@/src/lib/owner-playback-progress'

function harness(saved: Record<string, number> = {}) {
  const writes: Array<{ path: string; time: number; duration: number }> = []
  const progress = createOwnerPlaybackProgress({
    getSavedTime: (path) => saved[path] ?? null,
    saveTime: (path, time, duration) => writes.push({ path, time, duration }),
  })
  return { progress, writes }
}

describe('owner playback progress Interface', () => {
  test('Grant sources cannot read or write owner legacy playback state', () => {
    const { progress, writes } = harness({ 'SharedContent/public-video.mp4': 21 })

    expect(progress.load('SharedContent/public-video.mp4', 'grant')).toBeNull()
    progress.save(34, 100)

    expect(writes).toEqual([])
  })

  test('keeps an A-to-B switch bound to loaded source identity', () => {
    const { progress, writes } = harness({ 'Videos/a.mp4': 7, 'Videos/b.mp4': 11 })

    expect(progress.load('Videos/a.mp4', 'owner')).toBe(7)
    progress.save(8, 100)
    progress.release(9, 100)
    progress.save(10, 100)
    expect(progress.load('Videos/b.mp4', 'owner')).toBe(11)
    progress.save(12, 100)

    expect(writes).toEqual([
      { path: 'Videos/a.mp4', time: 8, duration: 100 },
      { path: 'Videos/a.mp4', time: 9, duration: 100 },
      { path: 'Videos/b.mp4', time: 12, duration: 100 },
    ])
  })

  test('release synchronously saves loaded identity then rejects delayed teardown events', () => {
    const { progress, writes } = harness()
    progress.load('Music/track.mp3', 'owner')
    progress.release(4, 10)
    progress.save(5, 10)
    expect(writes).toEqual([{ path: 'Music/track.mp3', time: 4, duration: 10 }])
  })

  test('release clears Grant identity without touching owner persistence', () => {
    const { progress, writes } = harness()
    progress.load('SharedContent/track.mp3', 'grant')
    progress.release(4, 10)
    progress.save(4, 10)
    expect(writes).toEqual([])
  })
})
