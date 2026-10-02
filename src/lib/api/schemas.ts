import { Schema } from 'effect'

const strings = Schema.mutable(Schema.Array(Schema.String))
const columns = Schema.Struct({
  createdDate: Schema.Boolean,
  size: Schema.Boolean,
  favorite: Schema.Boolean,
  views: Schema.Boolean,
})
const taskbarPin = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  isDirectory: Schema.Boolean,
  title: Schema.String,
  customIconName: Schema.optional(Schema.NullOr(Schema.String)),
  isVirtual: Schema.optional(Schema.Boolean),
  source: Schema.Struct({
    kind: Schema.Literal('local'),
    rootPath: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})
export const workspaceSettingsSchema = Schema.Struct({
  viewModes: Schema.Record(Schema.String, Schema.Literals(['list', 'grid'])),
  sortOrders: Schema.Record(
    Schema.String,
    Schema.Struct({
      field: Schema.Literals(['name', 'createdDate', 'size', 'favorite', 'views']),
      direction: Schema.Literals(['asc', 'desc']),
    }),
  ),
  fileColumns: Schema.Struct({ media: columns, workspace: columns }),
  favorites: strings,
  knowledgeBases: strings,
  customIcons: Schema.Record(Schema.String, Schema.String),
  autoSave: Schema.Record(
    Schema.String,
    Schema.Struct({ enabled: Schema.Boolean, readOnly: Schema.optional(Schema.Boolean) }),
  ),
  workspaceTransition: Schema.Literals(['instant', 'fade']),
  workspaceTaskbarPins: Schema.mutable(Schema.Array(taskbarPin)),
})
export const serverConfigSchema = Schema.Struct({
  editableFolders: strings,
  mediaRoots: Schema.mutable(
    Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String, editableFolders: strings }),
    ),
  ),
})
export const viewStatsSchema = Schema.Struct({ views: Schema.Record(Schema.String, Schema.Number) })
