import { describe, expect, test } from 'bun:test'

import {
  buildAudioExtractUrl,
  buildAudioMetadataUrl,
  buildImageUrl,
  buildShareMediaUrl,
  buildThumbnailUrl,
} from '@/src/lib/build-media-url'

describe('share media URLs', () => {
  test('uses full shared path instead of a browser-normalized dot segment for file shares', () => {
    const context = { token: 'token', sharePath: 'Shared/file name.md' }

    expect(buildShareMediaUrl('token', context.sharePath, context.sharePath)).toBe(
      '/api/share/token/media/Shared/file%20name.md',
    )
    expect(buildThumbnailUrl(context.sharePath, context)).toBe(
      '/api/share/token/thumbnail/Shared/file%20name.md',
    )
    expect(buildAudioMetadataUrl(context.sharePath, context)).toBe(
      '/api/share/token/audio/metadata/Shared/file%20name.md',
    )
    expect(buildAudioExtractUrl(context.sharePath, context)).toBe(
      '/api/share/token/audio/extract/Shared/file%20name.md',
    )
  })

  test('keeps directory-share file requests relative to share root', () => {
    expect(buildShareMediaUrl('token', 'Shared', 'Shared/nested/note.md')).toBe(
      '/api/share/token/media/nested/note.md',
    )
  })

  test('builds responsive image URLs with authorized share-relative paths', () => {
    expect(
      buildImageUrl(
        'Shared/nested/photo.jpg',
        { token: 'token', sharePath: 'Shared' },
        {
          width: 901.4,
          height: 600.6,
          dpr: 2,
          scale: 1.25,
          priority: 'next',
        },
      ),
    ).toBe(
      '/api/share/token/image/nested/photo.jpg?width=901&height=601&dpr=2&scale=1.25&priority=next',
    )
  })

  test('keeps crafted Grant tokens inside one encoded route segment', () => {
    const token = 'x/../../../api/files?dir=Vault#'
    expect(buildShareMediaUrl(token, 'Shared', 'Shared/track.mp3')).toBe(
      `/api/share/${encodeURIComponent(token)}/media/track.mp3`,
    )
  })
})
