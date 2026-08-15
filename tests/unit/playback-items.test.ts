import { describe, expect, test } from 'bun:test'
import {
  audioPlaybackQueueFromFiles,
  formatPlaybackTime,
  playbackItemFromFileItem,
  playbackItemFromPath,
  playbackPathMatches,
  playbackQueuesEqual,
} from '@/features/playback'
import { MediaType, type FileItem } from '@/lib/files/types'

function file(path: string, type: MediaType, isVirtual = false): FileItem {
  const name = path.split('/').at(-1) ?? path
  return {
    name,
    path,
    type,
    size: 1,
    extension: name.includes('.') ? (name.split('.').at(-1) ?? '') : '',
    isDirectory: false,
    isVirtual,
  }
}

describe('playback item helpers', () => {
  test('builds filesystem items and rejects unsupported or virtual files', () => {
    expect(playbackItemFromFileItem(file('Music/song.mp3', MediaType.AUDIO))).toEqual({
      locator: 'Music/song.mp3',
      name: 'song.mp3',
      media: 'audio',
    })
    expect(playbackItemFromFileItem(file('Videos/clip.mp4', MediaType.VIDEO))).toMatchObject({
      media: 'video',
    })
    expect(playbackItemFromFileItem(file('Music/song.mp3', MediaType.AUDIO, true))).toBeNull()
    expect(playbackItemFromPath('Notes/readme.md')).toBeNull()
  })

  test('matches slash variants and preserves the current item in an audio queue', () => {
    const current = playbackItemFromPath('Music\\song.mp3')!
    expect(playbackPathMatches(current, 'Music/song.mp3')).toBe(true)

    const queue = audioPlaybackQueueFromFiles(
      [
        file('Music/first.mp3', MediaType.AUDIO),
        file('Music/song.mp3', MediaType.AUDIO),
        file('Videos/clip.mp4', MediaType.VIDEO),
      ],
      current,
    )
    expect(queue).toEqual([
      { locator: 'Music/first.mp3', name: 'first.mp3', media: 'audio' },
      current,
    ])
  })

  test('compares queues and formats playback time consistently', () => {
    const first = playbackItemFromPath('Music/song.mp3')!
    const same = playbackItemFromPath('Music/song.mp3')!
    expect(playbackQueuesEqual([first], [same])).toBe(true)
    expect(playbackQueuesEqual([first], [])).toBe(false)
    expect(formatPlaybackTime(0)).toBe('0:00')
    expect(formatPlaybackTime(65.9)).toBe('1:05')
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00')
  })
})
