import { Schema } from 'effect'

export const sseEventSchema = Schema.Struct({
  type: Schema.String,
  path: Schema.optional(Schema.String),
  oldPath: Schema.optional(Schema.String),
  newPath: Schema.optional(Schema.String),
})
export type SseEventPayload = typeof sseEventSchema.Type
export const workerEventSchema = Schema.Struct({
  type: Schema.Literal('admin-sse'),
  data: sseEventSchema,
})
export const workerCommandSchema = Schema.Struct({
  type: Schema.Literals([
    'subscribe-admin',
    'unsubscribe-admin',
    'disconnect',
    'network-offline',
    'network-online',
  ]),
})
