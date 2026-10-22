import { Schema } from 'effect'
import { MediaType } from '@/lib/files/types'

const nullableString = Schema.NullOr(Schema.String)
const bounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
const tiling = Schema.Struct({
  cols: Schema.Number,
  rows: Schema.Number,
  colStart: Schema.Number,
  colEnd: Schema.Number,
  rowStart: Schema.Number,
  rowEnd: Schema.Number,
  colLines: Schema.Array(Schema.Number),
  rowLines: Schema.Array(Schema.Number),
})
const snapZone = Schema.Literals([
  'assist-custom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'top-half',
  'bottom-half',
  'top-third',
  'middle-third',
  'bottom-third',
  'left-third',
  'center-third',
  'right-third',
  'left-two-thirds',
  'right-two-thirds',
  'top-left-third',
  'top-center-third',
  'top-right-third',
  'bottom-left-third',
  'bottom-center-third',
  'bottom-right-third',
])
export const workspaceDocumentSchema = Schema.Struct({
  workspaceType: Schema.Literals(['desktop', 'canvas']),
  windows: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      type: Schema.Literals(['browser', 'viewer', 'hermes']),
      title: Schema.String,
      iconName: Schema.optional(nullableString),
      iconPath: Schema.optional(nullableString),
      iconType: Schema.optional(Schema.NullOr(Schema.Enum(MediaType))),
      iconIsVirtual: Schema.optional(Schema.Boolean),
      source: Schema.Struct({
        kind: Schema.Literal('local'),
        rootPath: Schema.optional(nullableString),
      }),
      initialState: Schema.Struct({
        dir: Schema.optional(nullableString),
        viewing: Schema.optional(nullableString),
        playing: Schema.optional(nullableString),
        audioOnly: Schema.optional(Schema.Boolean),
        imageSeed: Schema.optional(nullableString),
        readerKind: Schema.optional(Schema.NullOr(Schema.Literals(['pdf', 'folder', 'book']))),
      }),
      tabGroupId: Schema.optional(nullableString),
      openedFromWindowId: Schema.optional(nullableString),
      tabPinned: Schema.optional(Schema.Boolean),
      fileOpenTargetWindowId: Schema.optional(nullableString),
      layout: Schema.optional(
        Schema.Struct({
          bounds: Schema.optional(Schema.NullOr(bounds)),
          fullscreen: Schema.optional(Schema.Boolean),
          snapZone: Schema.optional(Schema.NullOr(snapZone)),
          minimized: Schema.optional(Schema.Boolean),
          zIndex: Schema.optional(Schema.Number),
          restoreBounds: Schema.optional(Schema.NullOr(bounds)),
          tiling: Schema.optional(Schema.NullOr(tiling)),
        }),
      ),
      hermes: Schema.optional(
        Schema.Struct({
          sessionId: Schema.optional(Schema.String),
          draftId: Schema.optional(Schema.String),
          cwd: Schema.optional(nullableString),
          readOnly: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
  activeWindowId: nullableString,
  activeTabMap: Schema.Record(Schema.String, Schema.String),
  nextWindowId: Schema.Number,
  tabGroupSplits: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ leftTabId: Schema.String, leftPaneFraction: Schema.Number }),
    ),
  ),
  canvas: Schema.optional(
    Schema.Struct({
      camera: Schema.Struct({ x: Schema.Number, y: Schema.Number, zoom: Schema.Number }),
      maximizedWindowId: nullableString,
      windowSizeByType: Schema.Record(
        Schema.String,
        Schema.Struct({ width: Schema.Number, height: Schema.Number }),
      ),
      nextZIndex: Schema.Number,
    }),
  ),
})
export const workspaceRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  iconColor: Schema.optional(Schema.String),
  snapshot: workspaceDocumentSchema,
  revision: Schema.Number,
  updatedAt: Schema.Number,
  lastOpenedAt: Schema.Number,
  locked: Schema.optional(Schema.Boolean),
})
export const workspaceRegistrySchema = Schema.Struct({
  version: Schema.Literal(1),
  order: Schema.Array(Schema.String),
  records: Schema.Record(Schema.String, workspaceRecordSchema),
})
export const workspaceOpenSchema = Schema.Struct({
  record: workspaceRecordSchema,
  editable: Schema.Boolean,
  leaseDurationMs: Schema.Number,
})
export const workspaceRevisionSchema = Schema.Struct({ revision: Schema.Number })
export const workspaceMoveSchema = Schema.Struct({
  sourceRevision: Schema.Number,
  destinationRevision: Schema.Number,
})
