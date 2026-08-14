import { describe, expect, test } from 'bun:test'
import {
  filesystemResourceAddress,
  filesystemResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { createPlaybackSession } from '@/src/features/playback'
import {
  applyFilesystemPlaybackPathMutation,
  createFilesystemPlaybackItem,
  filesystemAudioPlaybackQueue,
  filesystemPlaybackItemFromResource,
  filesystemPlaybackItemPath,
} from '@/src/integrations/filesystem/playback'

function resource(path: string, presentation: string): ResourceSummary {
  return {
    key: filesystemResourceKey('configured-default', path),
    name: path.split('/').at(-1) ?? path,
    kind: 'file',
    capabilities: ['read'],
    presentation,
    size: 1,
  }
}

describe('playback resources', () => {
  test('uses provider classification without inferring media from a path', () => {
    const ogg = filesystemPlaybackItemFromResource(resource('Media/ambiguous.ogg', 'video'))
    const mislabeled = filesystemPlaybackItemFromResource(
      resource('Media/audio.mp3', 'unsupported'),
    )

    expect(ogg?.media).toBe('video')
    expect(mislabeled).toBeNull()
    expect(filesystemResourceAddress(ogg!.resource)).toEqual({
      rootId: 'configured-default',
      path: 'Media/ambiguous.ogg',
    })
  })

  test('keeps only audio navigation entries plus the current video', () => {
    const current = createFilesystemPlaybackItem({
      path: 'Media/current.mp4',
      name: 'current.mp4',
      media: 'video',
    })
    const queue = filesystemAudioPlaybackQueue(
      [
        resource('Media/first.mp3', 'audio'),
        resource('Media/current.mp4', 'video'),
        resource('Media/skipped.mp4', 'video'),
        resource('Media/last.flac', 'audio'),
      ],
      current,
    )

    expect(queue.map(filesystemPlaybackItemPath)).toEqual([
      'Media/first.mp3',
      'Media/current.mp4',
      'Media/last.flac',
    ])
    expect(queue[1]).toBe(current)
  })

  test('updates owner identity on a path move', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: ({ item }) => ({ kind: 'resolved', url: `/media/${item.name}` }),
      },
    })
    const item = createFilesystemPlaybackItem({
      path: 'Music/old/track.mp3',
      name: 'track.mp3',
      media: 'audio',
    })
    session.dispatch({ type: 'load', item, autoplay: false, position: 12 })

    applyFilesystemPlaybackPathMutation(session, {
      type: 'path-moved',
      oldPath: 'Music/old',
      newPath: 'Music/new',
    })

    const moved = session.getSnapshot()
    expect(moved.currentItem && filesystemPlaybackItemPath(moved.currentItem)).toBe(
      'Music/new/track.mp3',
    )
    expect(filesystemResourceAddress(moved.currentItem!.resource)?.path).toBe('Music/new/track.mp3')
    expect(moved.position).toBe(12)
    expect(moved.desiredPlaying).toBe(false)
  })

  test('stops when a path mutation removes the current item', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: ({ item }) => ({ kind: 'resolved', url: `/media/${item.name}` }),
      },
    })
    const item = createFilesystemPlaybackItem({
      path: 'Music/track.mp3',
      name: 'track.mp3',
      media: 'audio',
    })
    session.dispatch({ type: 'load', item })

    applyFilesystemPlaybackPathMutation(session, { type: 'path-removed', path: 'Music' })

    expect(session.getSnapshot().phase).toBe('idle')
    expect(session.getSnapshot().currentItem).toBeNull()
  })

  test('does not infer path-mutation behavior for other providers', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: ({ item }) => ({ kind: 'resolved', url: `/media/${item.name}` }),
      },
    })
    session.dispatch({
      type: 'load',
      item: {
        resource: { provider: 'fixture', id: 'opaque-1' },
        name: 'track.mp3',
        media: 'audio',
      },
      autoplay: false,
    })

    applyFilesystemPlaybackPathMutation(session, {
      type: 'path-moved',
      oldPath: 'Music',
      newPath: 'Archive',
    })
    applyFilesystemPlaybackPathMutation(session, { type: 'path-removed', path: 'Music' })

    expect(session.getSnapshot().currentItem).toMatchObject({
      resource: { provider: 'fixture', id: 'opaque-1' },
      name: 'track.mp3',
    })
  })
})
