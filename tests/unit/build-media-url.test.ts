import { describe, expect, test } from 'bun:test'

import {
  buildAudioExtractUrl,
  buildAudioMetadataUrl,
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
})
