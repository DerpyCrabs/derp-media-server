import { Schema } from 'effect'

const track = Schema.Struct({
  id: Schema.String,
  index: Schema.NullOr(Schema.Number),
  codec: Schema.String,
  language: Schema.String,
  title: Schema.String,
  default: Schema.Boolean,
  supported: Schema.Boolean,
})
export const videoInfoSchema = Schema.Struct({
  fingerprint: Schema.String,
  duration: Schema.Number,
  container: Schema.String,
  video: Schema.NullOr(
    Schema.Struct({
      codec_name: Schema.String,
      profile: Schema.optional(Schema.String),
      level: Schema.optional(Schema.Number),
      pix_fmt: Schema.optional(Schema.String),
      width: Schema.Number,
      height: Schema.Number,
      r_frame_rate: Schema.optional(Schema.String),
      color_transfer: Schema.optional(Schema.String),
    }),
  ),
  audio: Schema.mutable(Schema.Array(track)),
  subtitles: Schema.mutable(Schema.Array(track)),
  allowVideoTranscoding: Schema.Boolean,
})
export const videoPreferencesSchema = Schema.Struct({
  global: Schema.Struct({
    audioLanguage: Schema.optional(Schema.String),
    subtitleLanguage: Schema.optional(Schema.String),
    secondarySubtitleLanguage: Schema.optional(Schema.String),
  }),
  video: Schema.Struct({
    speed: Schema.optional(Schema.Number),
    audioTrack: Schema.optional(Schema.NullOr(Schema.String)),
    subtitleTrack: Schema.optional(Schema.NullOr(Schema.String)),
    secondarySubtitleTrack: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})
export const audioMetadataSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  artist: Schema.optional(Schema.NullOr(Schema.String)),
  album: Schema.optional(Schema.NullOr(Schema.String)),
  genre: Schema.optional(Schema.NullOr(Schema.mutable(Schema.Array(Schema.String)))),
  year: Schema.optional(Schema.NullOr(Schema.Number)),
  trackNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  albumArtist: Schema.optional(Schema.NullOr(Schema.String)),
  coverArt: Schema.optional(Schema.NullOr(Schema.String)),
  duration: Schema.optional(Schema.NullOr(Schema.Number)),
})
export const playbackStatusSchema = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.String)),
})
