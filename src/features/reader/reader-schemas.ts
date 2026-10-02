import { Schema } from 'effect'

export const readerStateEnvelopeSchema = Schema.Struct({
  state: Schema.NullOr(
    Schema.Struct({
      kind: Schema.optional(Schema.Literals(['paged', 'book'])),
      pageIndex: Schema.optional(Schema.Number),
      scrollTop: Schema.optional(Schema.Number),
      zoom: Schema.optional(Schema.Number),
      viewMode: Schema.optional(Schema.Literals(['continuous', 'page'])),
      fitMode: Schema.optional(Schema.Literals(['manual', 'width', 'height'])),
      selectionMode: Schema.optional(Schema.Literals(['text', 'image'])),
      defaultAction: Schema.optional(Schema.Literals(['define', 'translate', 'none'])),
      chapterId: Schema.optional(Schema.String),
      anchor: Schema.optional(Schema.String),
      progress: Schema.optional(Schema.Number),
      chapterProgress: Schema.optional(Schema.Number),
      outlineExpanded: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  revision: Schema.Number,
  fingerprint: Schema.String,
})
export const readerStateSavedSchema = Schema.Struct({
  revision: Schema.Number,
  fingerprint: Schema.String,
})
export const readerRevisionSchema = Schema.Struct({ revision: Schema.Number })
export const legacyReaderPreferencesSchema = Schema.Struct({
  bookAppearance: Schema.optional(
    Schema.Struct({
      fontFamily: Schema.optional(Schema.String),
      fontScale: Schema.optional(Schema.NullOr(Schema.Number)),
      lineHeight: Schema.optional(Schema.NullOr(Schema.Number)),
      contentWidth: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      theme: Schema.optional(Schema.String),
    }),
  ),
  selectionMode: Schema.optional(Schema.String),
  defaultAction: Schema.optional(Schema.String),
  aiDetail: Schema.optional(Schema.String),
  outlineOpen: Schema.optional(Schema.Boolean),
})
export const readerPreferencesEnvelopeSchema = Schema.Struct({
  preferences: legacyReaderPreferencesSchema,
  revision: Schema.Number,
})
