import {
  persistedContentWindowRecord,
  restorePersistedContentWindow,
  type ContentWindowPersistencePort,
} from './content-window-persistence'
import type { ContentInstance } from './domain/content'
import type { ContentWindowDefinition } from './content-window'
import type {
  CanvasWindowSizeDto,
  PersistedCanvasStateDto,
  PersistedCanvasWindowDefinitionDto,
  PersistedCanvasWindowDto,
} from './generated/api-contracts'

export const CANVAS_SCHEMA_VERSION = 1
export const CANVAS_GRID_SIZE = 32
export const CANVAS_WINDOW_GAP = 8
export const CANVAS_MIN_ZOOM = 0.08
export const CANVAS_MAX_ZOOM = 1
export const CANVAS_MIN_WINDOW_WIDTH = 320
export const CANVAS_MIN_WINDOW_HEIGHT = 224

export type CanvasRect = { x: number; y: number; width: number; height: number }
export type CanvasCamera = { x: number; y: number; zoom: number }
export type CanvasWindowType = 'browser' | 'viewer' | 'integration'
export type CanvasWindowSizeKey =
  | CanvasWindowType
  | 'viewer-audio'
  | 'viewer-video'
  | 'viewer-image'
  | 'viewer-text'
  | 'viewer-pdf'
  | 'viewer-other'
export type CanvasWindowSize = Pick<CanvasRect, 'width' | 'height'>

export type CanvasWindow = {
  id: string
  definition: ContentWindowDefinition
  bounds: CanvasRect
  zIndex: number
}

export type InfiniteCanvasState = {
  version: 1
  windows: CanvasWindow[]
  maximizedWindowId: string | null
  camera: CanvasCamera
  windowSizeByType: Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
  nextItemId: number
  nextZIndex: number
}

export function createEmptyCanvasState(): InfiniteCanvasState {
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows: [],
    maximizedWindowId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    windowSizeByType: {},
    nextItemId: 1,
    nextZIndex: 1,
  }
}

function cloneContentInstance(instance: ContentInstance): ContentInstance {
  if (
    instance.type === 'integration' &&
    typeof instance.state === 'object' &&
    instance.state !== null &&
    !Array.isArray(instance.state)
  ) {
    return { ...instance, state: { ...instance.state } }
  }
  return { ...instance }
}

export function cloneInfiniteCanvasState(state: InfiniteCanvasState): InfiniteCanvasState {
  return {
    ...state,
    camera: { ...state.camera },
    windowSizeByType: Object.fromEntries(
      Object.entries(state.windowSizeByType).map(([key, size]) => [key, { ...size }]),
    ),
    windows: state.windows.map((window) => ({
      ...window,
      bounds: { ...window.bounds },
      definition: {
        ...window.definition,
        ...(window.definition.contentInstance
          ? {
              contentInstance: cloneContentInstance(window.definition.contentInstance),
            }
          : {}),
      },
    })),
  }
}

/** Compare live canvas state, including unsaved integration drafts. */
export function equalInfiniteCanvasState(
  left: InfiniteCanvasState,
  right: InfiniteCanvasState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function preserveArray<T>(current: T[], incoming: T[]): T[] {
  return current.length === incoming.length &&
    current.every((item, index) => item === incoming[index])
    ? current
    : incoming
}

export function reconcileInfiniteCanvasState(
  current: InfiniteCanvasState,
  incoming: InfiniteCanvasState,
  persistence: ContentWindowPersistencePort,
): InfiniteCanvasState {
  if (sameValue(current, incoming)) return current

  const currentWindows = new Map(current.windows.map((window) => [window.id, window]))
  const incomingWindows = incoming.windows.map((window) => {
    const existing = currentWindows.get(window.id)
    if (!existing) return window
    if (sameValue(existing, window)) return existing
    return sameValue(existing.definition, window.definition)
      ? { ...window, definition: existing.definition }
      : window
  })
  const incomingIds = new Set(incomingWindows.map((window) => window.id))
  const liveDrafts = current.windows.filter(
    (window) => persistence.isRuntimeOnly(window.definition) && !incomingIds.has(window.id),
  )
  const windows = preserveArray(current.windows, [...incomingWindows, ...liveDrafts])
  return {
    ...incoming,
    windows,
    camera: sameValue(current.camera, incoming.camera) ? current.camera : incoming.camera,
    windowSizeByType: sameValue(current.windowSizeByType, incoming.windowSizeByType)
      ? current.windowSizeByType
      : incoming.windowSizeByType,
  }
}

export function snapCanvasValue(value: number): number {
  return Math.round(value / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE
}

export function snapCanvasRect(rect: CanvasRect): CanvasRect {
  return {
    x: snapCanvasValue(rect.x),
    y: snapCanvasValue(rect.y),
    width: Math.max(CANVAS_MIN_WINDOW_WIDTH, snapCanvasValue(rect.width)),
    height: Math.max(CANVAS_MIN_WINDOW_HEIGHT, snapCanvasValue(rect.height)),
  }
}

export function rectsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function canvasWindowVisualBounds(bounds: CanvasRect): CanvasRect {
  const inset = CANVAS_WINDOW_GAP / 2
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(1, bounds.width - CANVAS_WINDOW_GAP),
    height: Math.max(1, bounds.height - CANVAS_WINDOW_GAP),
  }
}

function ringOffsets(ring: number): Array<[number, number]> {
  if (ring === 0) return [[0, 0]]
  const offsets: Array<[number, number]> = [
    [0, ring],
    [ring, 0],
    [0, -ring],
    [-ring, 0],
  ]
  for (let x = -ring; x <= ring; x += 1) {
    if (x !== 0) offsets.push([x, ring])
  }
  for (let y = ring - 1; y >= -ring; y -= 1) {
    if (y !== 0) offsets.push([ring, y])
  }
  for (let x = ring - 1; x >= -ring; x -= 1) {
    if (x !== 0) offsets.push([x, -ring])
  }
  for (let y = -ring + 1; y < ring; y += 1) {
    if (y !== 0) offsets.push([-ring, y])
  }
  return offsets
}

export function findNearestFreeCanvasRect(
  requested: CanvasRect,
  obstacles: CanvasRect[],
  maxRings = 80,
): CanvasRect {
  const base = snapCanvasRect(requested)
  for (let ring = 0; ring <= maxRings; ring += 1) {
    for (const [dx, dy] of ringOffsets(ring)) {
      const candidate = {
        ...base,
        x: base.x + dx * CANVAS_GRID_SIZE,
        y: base.y + dy * CANVAS_GRID_SIZE,
      }
      if (!obstacles.some((obstacle) => rectsOverlap(candidate, obstacle))) return candidate
    }
  }
  return base
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function parseRect(value: unknown): CanvasRect | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!hasOnlyKeys(value, ['x', 'y', 'width', 'height'])) return null
  const raw = value as Partial<CanvasRect>
  if (![raw.x, raw.y, raw.width, raw.height].every((part) => typeof part === 'number')) return null
  const width = finiteNumber(raw.width, 0)
  const height = finiteNumber(raw.height, 0)
  if (width <= 0 || height <= 0) return null
  return {
    x: finiteNumber(raw.x, 0),
    y: finiteNumber(raw.y, 0),
    width,
    height,
  }
}

function parseWindowSize(value: unknown): CanvasWindowSize | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!hasOnlyKeys(value, ['width', 'height'])) return undefined
  const raw = value as Partial<CanvasWindowSize>
  const bounds = snapCanvasRect({
    x: 0,
    y: 0,
    width: finiteNumber(raw.width, 0),
    height: finiteNumber(raw.height, 0),
  })
  if (finiteNumber(raw.width, 0) <= 0 || finiteNumber(raw.height, 0) <= 0) return undefined
  return { width: bounds.width, height: bounds.height }
}

function canvasItemNumber(id: string): number {
  const match = /^canvas-window-(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export function parseInfiniteCanvasState(
  value: unknown,
  persistence: ContentWindowPersistencePort,
): InfiniteCanvasState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (
    !hasOnlyKeys(value, [
      'version',
      'windows',
      'maximizedWindowId',
      'camera',
      'windowSizeByType',
      'nextItemId',
      'nextZIndex',
    ])
  ) {
    return null
  }
  const raw = value as Partial<InfiniteCanvasState>
  if (raw.version !== CANVAS_SCHEMA_VERSION || !Array.isArray(raw.windows)) {
    return null
  }
  const itemIds = new Set<string>()
  const windows: CanvasWindow[] = []
  for (const value of raw.windows) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasOnlyKeys(value, ['id', 'definition', 'bounds', 'zIndex'])
    ) {
      continue
    }
    const window = value as Partial<CanvasWindow>
    const bounds = parseRect(window.bounds)
    const definition = restorePersistedContentWindow(persistence, window.definition, [])
    if (!bounds || typeof window.id !== 'string' || itemIds.has(window.id) || !definition) continue
    if (definition.id !== window.id) continue
    itemIds.add(window.id)
    windows.push({
      id: window.id,
      definition: {
        ...definition,
        title: typeof definition.title === 'string' ? definition.title : window.id,
      },
      bounds,
      zIndex: Math.max(1, Math.floor(finiteNumber(window.zIndex, 1))),
    })
  }
  const cameraRaw = raw.camera as Partial<CanvasCamera> | undefined
  const sizesRaw = raw.windowSizeByType as
    | Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
    | undefined
  const sizeKeys: CanvasWindowSizeKey[] = [
    'browser',
    'viewer',
    'integration',
    'viewer-audio',
    'viewer-video',
    'viewer-image',
    'viewer-text',
    'viewer-pdf',
    'viewer-other',
  ]
  if (
    !cameraRaw ||
    typeof cameraRaw !== 'object' ||
    Array.isArray(cameraRaw) ||
    !hasOnlyKeys(cameraRaw, ['x', 'y', 'zoom']) ||
    !sizesRaw ||
    typeof sizesRaw !== 'object' ||
    Array.isArray(sizesRaw) ||
    !hasOnlyKeys(sizesRaw, sizeKeys)
  ) {
    return null
  }
  const windowSizeByType = Object.fromEntries(
    sizeKeys.flatMap((key) => {
      const size = parseWindowSize(sizesRaw?.[key])
      return size ? [[key, size]] : []
    }),
  ) as Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
  const nextItemId = Math.max(0, ...Array.from(itemIds, canvasItemNumber)) + 1
  const nextZIndex = Math.max(0, ...windows.map((window) => window.zIndex)) + 1
  const maximizedWindowId =
    typeof raw.maximizedWindowId === 'string' && itemIds.has(raw.maximizedWindowId)
      ? raw.maximizedWindowId
      : null
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows,
    maximizedWindowId,
    camera: {
      x: finiteNumber(cameraRaw?.x, 0),
      y: finiteNumber(cameraRaw?.y, 0),
      zoom: Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, finiteNumber(cameraRaw?.zoom, 1))),
    },
    windowSizeByType,
    nextItemId: Math.max(nextItemId, Math.floor(finiteNumber(raw.nextItemId, windows.length + 1))),
    nextZIndex: Math.max(nextZIndex, Math.floor(finiteNumber(raw.nextZIndex, windows.length + 1))),
  }
}

function persistedWindowSize(size: CanvasWindowSize | undefined): CanvasWindowSizeDto | undefined {
  return size ? { width: size.width, height: size.height } : undefined
}

export function persistedInfiniteCanvasState(
  state: InfiniteCanvasState,
  persistence: ContentWindowPersistencePort,
): PersistedCanvasStateDto {
  const windows = state.windows.flatMap<PersistedCanvasWindowDto>((window) => {
    const persisted = persistedContentWindowRecord(persistence, window.definition)
    if (!persisted) return []
    const definition: PersistedCanvasWindowDefinitionDto = {
      id: persisted.id,
      title: persisted.title,
      ...(persisted.iconName !== undefined ? { iconName: persisted.iconName } : {}),
      content: persisted.content,
    }
    return [
      {
        id: window.id,
        definition,
        bounds: {
          x: window.bounds.x,
          y: window.bounds.y,
          width: window.bounds.width,
          height: window.bounds.height,
        },
        zIndex: window.zIndex,
      },
    ]
  })
  const persistedWindowIds = new Set(windows.map((window) => window.id))
  const sizes = state.windowSizeByType
  const browser = persistedWindowSize(sizes.browser)
  const viewer = persistedWindowSize(sizes.viewer)
  const integration = persistedWindowSize(sizes.integration)
  const viewerAudio = persistedWindowSize(sizes['viewer-audio'])
  const viewerVideo = persistedWindowSize(sizes['viewer-video'])
  const viewerImage = persistedWindowSize(sizes['viewer-image'])
  const viewerText = persistedWindowSize(sizes['viewer-text'])
  const viewerPdf = persistedWindowSize(sizes['viewer-pdf'])
  const viewerOther = persistedWindowSize(sizes['viewer-other'])
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows,
    maximizedWindowId:
      state.maximizedWindowId !== null && persistedWindowIds.has(state.maximizedWindowId)
        ? state.maximizedWindowId
        : null,
    camera: { x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom },
    windowSizeByType: {
      ...(browser ? { browser } : {}),
      ...(viewer ? { viewer } : {}),
      ...(integration ? { integration } : {}),
      ...(viewerAudio ? { 'viewer-audio': viewerAudio } : {}),
      ...(viewerVideo ? { 'viewer-video': viewerVideo } : {}),
      ...(viewerImage ? { 'viewer-image': viewerImage } : {}),
      ...(viewerText ? { 'viewer-text': viewerText } : {}),
      ...(viewerPdf ? { 'viewer-pdf': viewerPdf } : {}),
      ...(viewerOther ? { 'viewer-other': viewerOther } : {}),
    },
    nextItemId: state.nextItemId,
    nextZIndex: state.nextZIndex,
  }
}

export function serializeInfiniteCanvasState(
  state: InfiniteCanvasState,
  persistence: ContentWindowPersistencePort,
): string {
  return JSON.stringify(persistedInfiniteCanvasState(state, persistence))
}
