import { describe, expect, test } from 'bun:test'
import { filesystemResourceAddress } from '@/lib/domain/resource'
import { MediaType, type FileItem } from '@/lib/types'
import {
  applyPlaybackPathMutation,
  audioPlaybackQueueFromFiles,
  createFilesystemPlaybackItem,
  createPlaybackSession,
  playbackItemFromFileItem,
} from '@/src/features/playback'

function file(path: string, type: FileItem['type']): FileItem {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    type,
    size: 1,
    extension: path.split('.').at(-1) ?? '',
    isDirectory: false,
  }
}

describe('playback resource adapters', () => {
  test('uses adapted classification without inferring media from a path', () => {
    const ogg = playbackItemFromFileItem(file('Media/ambiguous.ogg', MediaType.VIDEO))
    const mislabeled = playbackItemFromFileItem(file('Media/audio.mp3', MediaType.OTHER))

    expect(ogg?.media).toBe('video')
    expect(mislabeled).toBeNull()
    expect(filesystemResourceAddress(ogg!.resource)).toEqual({
      rootId: 'configured-default',
      path: 'Media/ambiguous.ogg',
    })
  })

  test('keeps only audio navigation entries plus the current video', () => {
    const current = createFilesystemPlaybackItem({
      locator: 'Media/current.mp4',
      name: 'current.mp4',
      media: 'video',
    })
    const queue = audioPlaybackQueueFromFiles(
      [
        file('Media/first.mp3', MediaType.AUDIO),
        file('Media/current.mp4', MediaType.VIDEO),
        file('Media/skipped.mp4', MediaType.VIDEO),
        file('Media/last.flac', MediaType.AUDIO),
      ],
      {},
      current,
    )

    expect(queue.map((item) => item.locator)).toEqual([
      'Media/first.mp3',
      'Media/current.mp4',
      'Media/last.flac',
    ])
    expect(queue[1]).toBe(current)
  })

  test('updates owner identity and locator on a path move', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: ({ item }) => ({ kind: 'resolved', url: `/media/${item.locator}` }),
      },
    })
    const item = createFilesystemPlaybackItem({
      locator: 'Music/old/track.mp3',
      name: 'track.mp3',
      media: 'audio',
    })
    session.dispatch({ type: 'load', item, autoplay: false, position: 12 })

    applyPlaybackPathMutation(session, {
      type: 'path-moved',
      oldPath: 'Music/old',
      newPath: 'Music/new',
    })

    const moved = session.getSnapshot()
    expect(moved.currentItem?.locator).toBe('Music/new/track.mp3')
    expect(filesystemResourceAddress(moved.currentItem!.resource)?.path).toBe('Music/new/track.mp3')
    expect(moved.position).toBe(12)
    expect(moved.desiredPlaying).toBe(false)
  })

  test('stops when a path mutation removes the current item', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: ({ item }) => ({ kind: 'resolved', url: `/media/${item.locator}` }),
      },
    })
    const item = createFilesystemPlaybackItem({
      locator: 'Music/track.mp3',
      name: 'track.mp3',
      media: 'audio',
    })
    session.dispatch({ type: 'load', item })

    applyPlaybackPathMutation(session, { type: 'path-removed', path: 'Music' })

    expect(session.getSnapshot().phase).toBe('idle')
    expect(session.getSnapshot().currentItem).toBeNull()
  })

  test('does not infer path-mutation behavior for other providers', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: ({ item }) => ({ kind: 'resolved', url: `/media/${item.locator}` }),
      },
    })
    session.dispatch({
      type: 'load',
      item: {
        resource: { provider: 'fixture', id: 'opaque-1' },
        locator: 'Music/track.mp3',
        name: 'track.mp3',
        media: 'audio',
      },
      autoplay: false,
    })

    applyPlaybackPathMutation(session, {
      type: 'path-moved',
      oldPath: 'Music',
      newPath: 'Archive',
    })
    applyPlaybackPathMutation(session, { type: 'path-removed', path: 'Music' })

    expect(session.getSnapshot().currentItem).toMatchObject({
      resource: { provider: 'fixture', id: 'opaque-1' },
      locator: 'Music/track.mp3',
    })
  })
})
