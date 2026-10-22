import { Effect, Schema, SchemaGetter } from 'effect'
import { MediaType } from './types'

const optionalNullable = <S extends Schema.Constraint>(schema: S) =>
  Schema.optional(
    Schema.NullOr(schema).pipe(
      Schema.decodeTo(Schema.UndefinedOr(Schema.toType(schema)), {
        decode: SchemaGetter.transform((value) => value ?? undefined),
        encode: SchemaGetter.transform((value) => value ?? null),
      }),
    ),
  )

export const fileItemSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.Enum(MediaType),
  size: Schema.Number,
  createdDate: Schema.optional(Schema.Number),
  extension: Schema.String,
  isDirectory: Schema.Boolean,
  isVirtual: Schema.optional(Schema.Boolean),
  viewCount: Schema.optional(Schema.Number),
  thumbnailGenerated: Schema.optional(Schema.Boolean),
  version: Schema.optional(Schema.Number),
})
export const directoryFilesSchema = Schema.Struct({
  files: Schema.mutable(Schema.Array(fileItemSchema)),
})
export const virtualCapabilitySchema = Schema.Literals([
  'open',
  'createFile',
  'createFolder',
  'rename',
  'archive',
  'restore',
  'deletePermanently',
  'deleteProject',
  'download',
  'copyId',
  'branch',
  'moveToProject',
  'addProjectFolder',
  'removeProjectFolder',
  'setPrimaryFolder',
  'setAppearance',
  'pin',
])
export const virtualOpenTargetSchema = Schema.StructWithRest(
  Schema.Struct({ provider: Schema.String, type: Schema.String }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export const virtualEntrySchema = Schema.Struct({
  provider: Schema.String,
  kind: Schema.String,
  id: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.Boolean),
  capabilities: Schema.Array(virtualCapabilitySchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  openTarget: Schema.optional(virtualOpenTargetSchema),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  appearance: Schema.optional(
    Schema.Struct({
      icon: Schema.String,
      tone: Schema.String,
      color: optionalNullable(Schema.String),
    }),
  ),
})
export const virtualDirectorySchema = Schema.Struct({
  provider: Schema.String,
  kind: Schema.String,
  path: Schema.String,
  capabilities: Schema.Array(virtualCapabilitySchema),
  offset: Schema.Number,
  pageSize: Schema.Number,
  total: Schema.Number,
  nextOffset: optionalNullable(Schema.Number),
})
export const directoryListingSchema = Schema.Struct({
  files: Schema.mutable(Schema.Array(fileItemSchema)),
  virtualDirectory: optionalNullable(virtualDirectorySchema),
  virtualEntries: Schema.optional(Schema.Record(Schema.String, virtualEntrySchema)),
})
const rootStatusSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  state: Schema.Literals(['building', 'ready', 'refreshing', 'partial', 'error']),
  refreshMode: Schema.Literals(['recursive-watch', 'polling', 'degraded']),
  indexedEntries: Schema.Number,
  scannedDirectories: Schema.Number,
  lastCompleteAt: Schema.NullOr(Schema.Number),
  error: Schema.optional(Schema.String),
})
export const fileSearchStatusSchema = Schema.Struct({
  state: Schema.Literals([
    'starting',
    'building',
    'ready',
    'refreshing',
    'partial',
    'error',
    'disabled',
  ]),
  stale: Schema.Boolean,
  indexedEntries: Schema.Number,
  scannedDirectories: Schema.Number,
  watcherCount: Schema.Number,
  roots: Schema.mutable(Schema.Array(rootStatusSchema)),
  error: Schema.optional(Schema.String),
})
export const fileSearchResultSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  parentPath: Schema.String,
  rootId: Schema.String,
  rootName: Schema.String,
  isDirectory: Schema.Boolean,
  extension: Schema.String,
  type: Schema.Enum(MediaType),
})
export const fileSearchResponseSchema = Schema.Struct({
  results: Schema.mutable(Schema.Array(fileSearchResultSchema)),
  truncated: Schema.Boolean,
  status: fileSearchStatusSchema,
})
export const knowledgeBaseSearchSchema = Schema.Struct({
  results: Schema.mutable(
    Schema.Array(
      Schema.Struct({ path: Schema.String, name: Schema.String, snippet: Schema.String }),
    ),
  ),
})
export const knowledgeBaseRecentSchema = Schema.Struct({
  results: Schema.mutable(
    Schema.Array(
      Schema.Struct({ path: Schema.String, name: Schema.String, modifiedAt: Schema.String }),
    ),
  ),
})
