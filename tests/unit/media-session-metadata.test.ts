import { describe, expect, test } from 'bun:test'
import { buildPlaybackMediaSessionMetadata } from '@/features/playback/media-session-metadata'

describe('playback media session metadata', () => {
  test('publishes track information and artwork for the active audio item', () => {
    expect(
      buildPlaybackMediaSessionMetadata({
        item: {
          locator: 'Music/Long Season.flac',
          name: 'Long Season.flac',
          media: 'audio',
        },
        mode: 'audio',
        metadata: {
          title: 'Long Season',
          artist: 'Fishmans',
          album: 'Long Season',
        },
        artworkUrl: '/api/media/Music/cover.jpg',
        artworkBaseUrl: 'http://localhost:3000',
      }),
    ).toEqual({
      title: 'Long Season',
      artist: 'Fishmans',
      album: 'Long Season',
      artwork: [
        {
          src: 'http://localhost:3000/api/media/Music/cover.jpg',
          sizes: '512x512',
          type: 'image/jpeg',
        },
        {
          src: 'http://localhost:3000/api/media/Music/cover.jpg',
          sizes: '256x256',
          type: 'image/jpeg',
        },
        {
          src: 'http://localhost:3000/api/media/Music/cover.jpg',
          sizes: '128x128',
          type: 'image/jpeg',
        },
      ],
    })
  })
})
