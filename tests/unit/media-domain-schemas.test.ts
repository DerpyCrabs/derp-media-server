import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { MediaType } from '@/lib/files/types'
import {
  recommendationPageSchema,
  readingBooksSchema,
  initialRecommendationPagesSchema,
  refreshRecommendationSchema,
  asFile,
} from '@/features/media-ai/recommendation-model'
import { musicHomeSchema, indexingStatusSchema } from '@/features/music/schemas'
import { eventFrameSchema, modelOptionsSchema } from '@/features/hermes/hermes-api'

const book = {
  name: 'Book.pdf',
  path: 'Books/Book.pdf',
  type: 'pdf',
  size: 42,
  readingProgress: 0.5,
  pageIndex: null,
  lastRead: 123,
}
const page = {
  rows: [{ title: 'For you', items: [book] }],
  generatedAt: 123,
  profileResetAt: null,
  nextCursor: null,
  feedId: 'feed',
}

test('reading and recommendation contracts accept Rust nullable positions without inventing missing FileItem fields', () => {
  const reading = Schema.decodeUnknownSync(readingBooksSchema)({ items: [book] })
  const home = Schema.decodeUnknownSync(recommendationPageSchema)(page)
  expect(reading.items[0]?.pageIndex).toBeNull()
  expect(home.profileResetAt).toBeNull()
  expect(asFile(reading.items[0]!)).toEqual({
    name: 'Book.pdf',
    path: 'Books/Book.pdf',
    type: MediaType.PDF,
    size: 42,
    extension: 'pdf',
    isDirectory: false,
  })
})

test('recursive recommendation members and bootstrap pages validate before reaching playback or the cache', () => {
  const collection = {
    name: 'Show',
    path: 'Shows/Show',
    type: 'folder',
    members: [{ name: 'Episode.mp4', path: 'Shows/Show/Episode.mp4', type: 'video' }],
  }
  expect(
    Schema.decodeUnknownExit(recommendationPageSchema)({
      ...page,
      rows: [{ title: 'Shows', items: [collection] }],
    })._tag,
  ).toBe('Success')
  expect(
    Schema.decodeUnknownExit(recommendationPageSchema)({
      ...page,
      rows: [{ title: 'Shows', items: [{ ...collection, members: [{ path: 42 }] }] }],
    })._tag,
  ).toBe('Failure')
  expect(
    Schema.decodeUnknownExit(initialRecommendationPagesSchema)({
      pages: [page],
      pageParams: [{ cursor: 0, feedId: null }],
    })._tag,
  ).toBe('Success')
  expect(
    Schema.decodeUnknownExit(initialRecommendationPagesSchema)({
      pages: ['invalid'],
      pageParams: [{ cursor: 0 }],
    })._tag,
  ).toBe('Failure')
})

test('refresh distinguishes a prepared page from an explicit refresh acknowledgment', () => {
  expect(Schema.decodeUnknownExit(refreshRecommendationSchema)(page)._tag).toBe('Success')
  expect(Schema.decodeUnknownExit(refreshRecommendationSchema)({ ok: true })._tag).toBe('Success')
  expect(Schema.decodeUnknownExit(refreshRecommendationSchema)({ rows: 'invalid' })._tag).toBe(
    'Failure',
  )
})

test('music home validates nested genre views and indexing progress variants', () => {
  const home = {
    radio: { tracks: [], stations: [] },
    rows: [],
    albums: [],
    mixes: [],
    genres: [],
    genreViews: { Jazz: { rows: [], albums: [], mixes: [] } },
    total: 0,
    searchEnabled: true,
    aiEnabled: true,
    paused: false,
    curationError: null,
  }
  expect(Schema.decodeUnknownExit(musicHomeSchema)(home)._tag).toBe('Success')
  expect(
    Schema.decodeUnknownExit(musicHomeSchema)({ ...home, genreViews: { Jazz: { rows: 'broken' } } })
      ._tag,
  ).toBe('Failure')
  expect(
    Schema.decodeUnknownExit(indexingStatusSchema)({
      enabled: true,
      progress: { phase: 'discovering', found: 2, completed: 0 },
    })._tag,
  ).toBe('Success')
  expect(
    Schema.decodeUnknownExit(indexingStatusSchema)({
      enabled: true,
      progress: { phase: 'processing', completed: 'bad', total: 2 },
    })._tag,
  ).toBe('Failure')
})

test('Hermes event envelopes reject malformed payloads while preserving unknown tool fields', () => {
  const event = {
    type: 'tool.start',
    durable_session_id: 'session',
    payload: { name: 'future.tool', args: { newField: true } },
  }
  const decoded = Schema.decodeUnknownSync(eventFrameSchema)({ params: event })
  expect('params' in decoded && decoded.params.payload?.args).toEqual({ newField: true })
  expect(Schema.decodeUnknownExit(eventFrameSchema)({ ...event, payload: 'invalid' })._tag).toBe(
    'Failure',
  )
  expect(
    Schema.decodeUnknownExit(modelOptionsSchema)({ providers: [{ models: [123] }] })._tag,
  ).toBe('Failure')
})
