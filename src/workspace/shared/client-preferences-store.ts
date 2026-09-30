import { Option, Schema } from 'effect'
import { modelOwner } from 'effectweb'
import type { FileOpenTarget } from '@/lib/models/open-target'
import { type AssistGridShape, isAssistGridShape } from '@/workspace/model/workspace-assist-grid'
import { readPersistedState, writePersistedState } from '@/lib/state/client-store-utils'

export const FILE_OPEN_TARGET_STORAGE_KEY = 'workspace-file-open-target-v2'
export const WORKSPACE_LAYOUT_STORAGE_KEY = 'workspace-preferred-snap'
export const MAX_TILED_WINDOW_GAP = 24

const fileOpenPersistedSchema = Schema.Struct({ target: Schema.optional(Schema.Unknown) })
const layoutPersistedSchema = Schema.Struct({
  assistGridShape: Schema.optional(Schema.Unknown),
  snapAssistOnTopDrag: Schema.optional(Schema.Unknown),
  tiledWindowGap: Schema.optional(Schema.Unknown),
})
type FileOpenPersisted = typeof fileOpenPersistedSchema.Type
type LayoutPersisted = typeof layoutPersistedSchema.Type

type ClientPreferences = {
  fileOpenTarget: FileOpenTarget
  assistGridShape: AssistGridShape
  snapAssistOnTopDrag: boolean
  tiledWindowGap: number
}

const DEFAULTS: ClientPreferences = {
  fileOpenTarget: 'new-window',
  assistGridShape: '3x2',
  snapAssistOnTopDrag: true,
  tiledWindowGap: 0,
}

export function normalizeTiledWindowGap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_TILED_WINDOW_GAP, Math.round(value)))
}

function parsePersisted<A>(raw: string | null, schema: Schema.Decoder<A>): A | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const envelope = Schema.decodeUnknownOption(Schema.Struct({ state: schema }))(parsed)
    return Option.isSome(envelope) ? envelope.value.state : null
  } catch {
    return null
  }
}

function normalizeFileOpen(value: FileOpenPersisted | null): FileOpenTarget {
  return value?.target === 'new-tab' || value?.target === 'new-window'
    ? value.target
    : DEFAULTS.fileOpenTarget
}

function normalizeLayout(value: LayoutPersisted | null) {
  return {
    assistGridShape:
      typeof value?.assistGridShape === 'string' && isAssistGridShape(value.assistGridShape)
        ? value.assistGridShape
        : DEFAULTS.assistGridShape,
    snapAssistOnTopDrag:
      typeof value?.snapAssistOnTopDrag === 'boolean'
        ? value.snapAssistOnTopDrag
        : DEFAULTS.snapAssistOnTopDrag,
    tiledWindowGap: normalizeTiledWindowGap(value?.tiledWindowGap),
  }
}

const initialFile = readPersistedState(FILE_OPEN_TARGET_STORAGE_KEY, fileOpenPersistedSchema)
const initialLayout = readPersistedState(WORKSPACE_LAYOUT_STORAGE_KEY, layoutPersistedSchema)
const owner = modelOwner<ClientPreferences>({
  ...DEFAULTS,
  fileOpenTarget: normalizeFileOpen(initialFile),
  ...normalizeLayout(initialLayout),
})

function persistFileOpen(target: FileOpenTarget = owner.read().fileOpenTarget) {
  writePersistedState(FILE_OPEN_TARGET_STORAGE_KEY, { target })
}

function persistLayout(
  overrides: {
    assistGridShape?: AssistGridShape
    snapAssistOnTopDrag?: boolean
    tiledWindowGap?: number
  } = {},
) {
  writePersistedState(WORKSPACE_LAYOUT_STORAGE_KEY, {
    assistGridShape: overrides.assistGridShape ?? owner.read().assistGridShape,
    snapAssistOnTopDrag: overrides.snapAssistOnTopDrag ?? owner.read().snapAssistOnTopDrag,
    tiledWindowGap: overrides.tiledWindowGap ?? owner.read().tiledWindowGap,
  })
}

export function syncClientPreferenceStorage(key: string, raw: string | null) {
  if (key === FILE_OPEN_TARGET_STORAGE_KEY) {
    const fileOpenTarget = normalizeFileOpen(parsePersisted(raw, fileOpenPersistedSchema))
    owner.patch({ fileOpenTarget })
  } else if (key === WORKSPACE_LAYOUT_STORAGE_KEY) {
    const layout = normalizeLayout(parsePersisted(raw, layoutPersistedSchema))
    owner.patch(layout)
  } else {
    return
  }
}

export function createClientPreferencesLifetime() {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return
    syncClientPreferenceStorage(event.key ?? '', event.newValue)
  }
  window.addEventListener('storage', onStorage)
  return { dispose: () => window.removeEventListener('storage', onStorage) }
}

export const clientPreferencesStore = {
  source: owner.source,
  read: owner.read,
  setFileOpenTarget(this: void, value: FileOpenTarget) {
    owner.patch({ fileOpenTarget: value })
    persistFileOpen(value)
  },
  setAssistGridShape(this: void, value: AssistGridShape) {
    owner.patch({ assistGridShape: value })
    persistLayout({ assistGridShape: value })
  },
  setSnapAssistOnTopDrag(this: void, value: boolean) {
    owner.patch({ snapAssistOnTopDrag: value })
    persistLayout({ snapAssistOnTopDrag: value })
  },
  setTiledWindowGap(this: void, value: number) {
    const normalizedGap = normalizeTiledWindowGap(value)
    owner.patch({ tiledWindowGap: normalizedGap })
    persistLayout({ tiledWindowGap: normalizedGap })
  },
}
