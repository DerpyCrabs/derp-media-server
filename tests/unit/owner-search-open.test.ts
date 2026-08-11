import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import { ownerSearchResultHref } from '@/src/owner/owner-search-open'

function result(type: MediaType, isDirectory = false) {
  return {
    name: isDirectory ? 'Photos' : `item.${type}`,
    path: isDirectory ? 'Media/Photos' : `Media/item.${type}`,
    parentPath: 'Media',
    rootId: 'media',
    rootName: 'Media',
    isDirectory,
    extension: isDirectory ? '' : type,
    type,
  }
}

describe('owner search open planning', () => {
  test('keeps browse, playback, and viewer route dispositions', () => {
    expect(ownerSearchResultHref(result(MediaType.FOLDER, true))).toBe('/?dir=Media%2FPhotos')
    expect(ownerSearchResultHref(result(MediaType.AUDIO))).toBe(
      '/?dir=Media&playing=Media%2Fitem.audio',
    )
    expect(ownerSearchResultHref(result(MediaType.IMAGE))).toBe(
      '/?dir=Media&viewing=Media%2Fitem.image&viewer=image-viewer',
    )
  })
})
