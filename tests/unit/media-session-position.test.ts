import { describe, expect, test } from 'bun:test'
import { setPlaybackMediaSessionPosition } from '@/features/playback/media-session-position'

describe('playback media session position', () => {
  test('publishes a valid clamped position', () => {
    const calls: unknown[] = []
    setPlaybackMediaSessionPosition(
      { setPositionState: (state) => calls.push(state) },
      { duration: 120, position: 150, playbackRate: 1 },
    )

    expect(calls).toEqual([{ duration: 120, position: 120, playbackRate: 1 }])
  })

  test('ignores invalid media state and tolerates browser rejection', () => {
    const calls: unknown[] = []
    setPlaybackMediaSessionPosition(
      { setPositionState: (state) => calls.push(state) },
      { duration: 0, position: 0, playbackRate: 1 },
    )
    expect(calls).toEqual([])

    expect(() =>
      setPlaybackMediaSessionPosition(
        {
          setPositionState: () => {
            throw new Error('invalid state')
          },
        },
        { duration: 10, position: 2, playbackRate: 1 },
      ),
    ).not.toThrow()
  })
})
