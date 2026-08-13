import { describe, expect, test } from 'bun:test'

import {
  buildAudioExtractUrl,
  buildAudioMetadataUrl,
  buildImageUrl,
  buildMediaUrl,
  buildThumbnailUrl,
} from '@/src/lib/build-media-url'

describe('media URLs', () => {
  test('encodes media paths by segment', () => {
    expect(buildMediaUrl('Notes/file name.md')).toBe('/api/media/Notes/file%20name.md')
    expect(buildThumbnailUrl('Images/photo one.jpg')).toBe('/api/thumbnail/Images/photo%20one.jpg')
  })

  test('builds audio endpoints', () => {
    expect(buildAudioMetadataUrl('Audio/song.mp3')).toBe('/api/audio/metadata/Audio/song.mp3')
    expect(buildAudioExtractUrl('Video/clip.mp4')).toBe('/api/audio/extract/Video/clip.mp4')
  })

  test('builds responsive image requests', () => {
    expect(
      buildImageUrl('Images/photo.jpg', {
        width: 901.4,
        height: 600.6,
        dpr: 2,
        scale: 1.25,
        priority: 'next',
      }),
    ).toBe('/api/image/Images/photo.jpg?width=901&height=601&dpr=2&scale=1.25&priority=next')
  })
})
