import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import { offlineRenderersForFile } from '@/src/lib/offline-renderers'

describe('offline renderer compatibility plan', () => {
  test('keeps optional viewers available only for saved file types that need them', () => {
    expect(offlineRenderersForFile({ type: MediaType.TEXT, extension: 'txt' })).toEqual(['text'])
    expect(offlineRenderersForFile({ type: MediaType.TEXT, extension: 'MD' })).toEqual([
      'text',
      'markdown',
    ])
    expect(offlineRenderersForFile({ type: MediaType.IMAGE, extension: 'jpg' })).toEqual(['image'])
    expect(offlineRenderersForFile({ type: MediaType.OTHER, extension: 'bin' })).toEqual([
      'unsupported',
    ])
    expect(offlineRenderersForFile({ type: MediaType.PDF, extension: 'pdf' })).toEqual([])
    expect(offlineRenderersForFile({ type: MediaType.BOOK, extension: 'epub' })).toEqual([])
    expect(offlineRenderersForFile({ type: MediaType.VIDEO, extension: 'mp4' })).toEqual([])
  })
})
