import { expect, test } from 'bun:test'
import { Option, Schema } from 'effect'
import { audioMetadataSchema, videoInfoSchema } from '@/features/playback/playback-schemas'
import { readerStateEnvelopeSchema } from '@/features/reader/reader-schemas'

test('audio metadata accepts Rust nulls for absent tags and duration', () => {
  const metadata = {
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNumber: null,
    albumArtist: null,
    coverArt: null,
    duration: null,
  }
  expect(Schema.decodeUnknownSync(audioMetadataSchema)(metadata)).toEqual(metadata)
  expect(Option.isNone(Schema.decodeUnknownOption(audioMetadataSchema)({ title: 42 }))).toBe(true)
})

test('malformed track payloads cannot enter the playback query cache', () => {
  const metadata = {
    fingerprint: 'v1',
    duration: 42,
    container: 'mp4',
    video: null,
    audio: [
      {
        id: 'audio:0',
        index: 0,
        codec: 'aac',
        language: 'en',
        title: 'English',
        default: true,
        supported: true,
      },
    ],
    subtitles: [],
    allowVideoTranscoding: true,
  }
  expect(Option.isSome(Schema.decodeUnknownOption(videoInfoSchema)(metadata))).toBe(true)
  expect(
    Option.isNone(
      Schema.decodeUnknownOption(videoInfoSchema)({
        ...metadata,
        audio: [{ ...metadata.audio[0], supported: 'yes' }],
      }),
    ),
  ).toBe(true)
})

test('reader state accepts empty server state but rejects a nonnumeric revision', () => {
  const state = { state: null, revision: 0, fingerprint: 'v1' }
  expect(Schema.decodeUnknownSync(readerStateEnvelopeSchema)(state)).toEqual(state)
  expect(
    Option.isNone(
      Schema.decodeUnknownOption(readerStateEnvelopeSchema)({ ...state, revision: '1' }),
    ),
  ).toBe(true)
})
