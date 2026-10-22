import { Schema } from 'effect'

const array = <S extends Schema.Constraint>(item: S) => Schema.mutable(Schema.Array(item))
export const musicTrackSchema = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  title: Schema.String,
  artist: Schema.String,
  album: Schema.String,
  albumArtist: Schema.String,
  genre: array(Schema.String),
  genreSource: Schema.String,
  duration: Schema.Number,
  trackNumber: Schema.Number,
  year: Schema.Number,
  liked: Schema.Boolean,
  plays: Schema.Number,
  lastPlayed: Schema.Number,
  reason: Schema.String,
  hasArtwork: Schema.optional(Schema.Boolean),
})
const sections = {
  rows: array(
    Schema.Struct({ id: Schema.String, title: Schema.String, items: array(musicTrackSchema) }),
  ),
  albums: array(
    Schema.Struct({
      title: Schema.String,
      artist: Schema.String,
      items: array(musicTrackSchema),
      cover: Schema.optional(musicTrackSchema),
    }),
  ),
  mixes: array(
    Schema.Struct({ genre: Schema.String, count: Schema.Number, items: array(musicTrackSchema) }),
  ),
}
export const musicHomeSchema = Schema.Struct({
  ...sections,
  radio: Schema.Struct({
    tracks: array(musicTrackSchema),
    stations: array(
      Schema.Struct({ genre: Schema.String, artist: Schema.String, items: array(Schema.String) }),
    ),
  }),
  genres: array(Schema.String),
  genreViews: Schema.Record(Schema.String, Schema.Struct(sections)),
  total: Schema.Number,
  searchEnabled: Schema.Boolean,
  aiEnabled: Schema.Boolean,
  paused: Schema.Boolean,
  curationError: Schema.optional(Schema.NullOr(Schema.String)),
})
export const indexingStatusSchema = Schema.Struct({
  enabled: Schema.Boolean,
  paused: Schema.optional(Schema.Boolean),
  progress: Schema.optional(
    Schema.Union([
      Schema.Struct({
        phase: Schema.Literal('discovering'),
        found: Schema.Number,
        completed: Schema.Number,
        warning: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        phase: Schema.Literals(['processing', 'complete']),
        completed: Schema.Number,
        total: Schema.Number,
        warning: Schema.optional(Schema.String),
      }),
    ]),
  ),
})
export type IndexingStatus = typeof indexingStatusSchema.Type
