import { Schema } from 'effect'
import { apiSchemaEffect } from '@/lib/api/client'

export const objectResponse = Schema.Record(Schema.String, Schema.Unknown)

export function jsonRequest(url: string, init?: RequestInit) {
  return apiSchemaEffect(objectResponse, url, init)
}

export const capabilitiesSchema = Schema.Struct({
  transcription: Schema.optional(Schema.Boolean),
  playback: Schema.optional(Schema.Boolean),
  maxRecordingSeconds: Schema.optional(Schema.Number),
})
export const sessionMessagesSchema = Schema.Struct({
  messages: Schema.optional(Schema.Array(Schema.Unknown)),
  data: Schema.optional(Schema.Array(Schema.Unknown)),
})
export const sessionDetailSchema = Schema.Struct({
  archived: Schema.optional(Schema.Boolean),
  externallyActive: Schema.optional(Schema.Boolean),
  source: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})
export const completionsSchema = Schema.Struct({
  items: Schema.optional(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        display: Schema.optional(Schema.String),
        meta: Schema.optional(Schema.String),
        kind: Schema.optional(Schema.String),
      }),
    ),
  ),
})
export const modelOptionsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  providers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        authenticated: Schema.optional(Schema.Boolean),
        slug: Schema.optional(Schema.String),
        name: Schema.optional(Schema.String),
        models: Schema.optional(Schema.Array(Schema.String)),
        capabilities: Schema.optional(
          Schema.Record(
            Schema.String,
            Schema.Struct({
              reasoning: Schema.optional(Schema.Boolean),
              fast: Schema.optional(Schema.Boolean),
            }),
          ),
        ),
      }),
    ),
  ),
})
export const virtualDetailSchema = Schema.Struct({
  session: Schema.Record(Schema.String, Schema.Unknown),
  messages: Schema.Unknown,
})
export const virtualActionSchema = Schema.Struct({ openTarget: Schema.optional(Schema.Unknown) })
export const gatewayDirectoriesSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({ name: Schema.String, path: Schema.String, isDirectory: Schema.Boolean }),
  ),
  error: Schema.optional(Schema.String),
})
const eventSchema = Schema.Struct({
  type: Schema.String,
  durable_session_id: Schema.optional(Schema.String),
  previous_durable_session_id: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export const eventFrameSchema = Schema.Union([Schema.Struct({ params: eventSchema }), eventSchema])
