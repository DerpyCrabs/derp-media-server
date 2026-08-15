import { describe, expect, test } from 'bun:test'
import {
  applyPlaybackPathMutation,
  createPlaybackSession,
  type PlaybackSourceRequest,
} from '@/features/playback'

const resolve = (request: PlaybackSourceRequest) => ({
  kind: 'resolved' as const,
  url: `/media/${request.item.locator}`,
})

function item(locator: string, media: 'audio' | 'video' = 'audio') {
  return { locator, name: locator.split('/').at(-1) ?? locator, media } as const
}

describe('playback path mutations', () => {
  test('moves the active item and preserves its queue position', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve } })
    const current = item('Old/clip.mp4', 'video')
    const other = item('Old/song.mp3')
    session.dispatch({ type: 'load', item: current, queue: [current, other], mode: 'video' })
    session.dispatch({ type: 'mediaTime', generation: 1, position: 18, duration: 60 })

    applyPlaybackPathMutation(session, {
      type: 'path-moved',
      oldPath: 'Old',
      newPath: 'New',
    })

    expect(session.getSnapshot()).toMatchObject({
      currentItem: item('New/clip.mp4', 'video'),
      position: 18,
      queue: [item('New/clip.mp4', 'video'), item('New/song.mp3')],
    })
  })

  test('stops when the current item is removed and filters removed queue items', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve } })
    const current = item('Keep/song.mp3')
    const removed = item('Trash/old.mp3')
    session.dispatch({ type: 'load', item: current, queue: [current, removed] })

    applyPlaybackPathMutation(session, { type: 'path-removed', path: 'Trash' })
    expect(session.getSnapshot().queue).toEqual([current])
    expect(session.getSnapshot().currentItem).toEqual(current)

    applyPlaybackPathMutation(session, { type: 'path-removed', path: 'Keep' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', currentItem: null, queue: [] })
  })
})
