import type { WorkspaceWindowDefinition } from './use-workspace'
import { deletedHermesSessionIds } from './hermes-session-store'

export const CANVAS_STORAGE_KEY = 'infinite-canvas-state-v1'
export const CANVAS_SCHEMA_VERSION = 1
export const CANVAS_GRID_SIZE = 32
export const CANVAS_WINDOW_GAP = 8
export const CANVAS_MIN_ZOOM = 0.08
export const CANVAS_MAX_ZOOM = 1
export const CANVAS_MIN_WINDOW_WIDTH = 320
export const CANVAS_MIN_WINDOW_HEIGHT = 224

export type CanvasRect = { x: number; y: number; width: number; height: number }
export type CanvasCamera = { x: number; y: number; zoom: number }
export type CanvasWindowType = 'browser' | 'viewer' | 'hermes'
export type CanvasWindowSizeKey =
  | CanvasWindowType
  | 'viewer-audio'
  | 'viewer-video'
  | 'viewer-image'
  | 'viewer-text'
  | 'viewer-pdf'
  | 'viewer-other'
export type CanvasWindowSize = Pick<CanvasRect, 'width' | 'height'>

export type CanvasCardKind = 'note'

export type CanvasCard = {
  id: string
  kind: CanvasCardKind
  title: string
  body: string
  url: string | null
  color: string
  bounds: CanvasRect
  zIndex: number
  locked: boolean
  tags: string[]
}

export type CanvasConnector = {
  id: string
  fromId: string
  toId: string
  label: string
  color: string
}

export type CanvasWindow = {
  id: string
  definition: WorkspaceWindowDefinition
  bounds: CanvasRect
  zIndex: number
  locked?: boolean
}

export type InfiniteCanvasState = {
  version: 1
  windows: CanvasWindow[]
  cards: CanvasCard[]
  connectors: CanvasConnector[]
  camera: CanvasCamera
  windowSizeByType: Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
  nextItemId: number
  nextZIndex: number
}

export function createEmptyCanvasState(): InfiniteCanvasState {
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows: [],
    cards: [],
    connectors: [],
    camera: { x: 0, y: 0, zoom: 1 },
    windowSizeByType: {},
    nextItemId: 1,
    nextZIndex: 1,
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
  const offsets: Array<[number, number]> = []
  for (let x = -ring; x <= ring; x += 1) offsets.push([x, -ring])
  for (let y = -ring + 1; y <= ring; y += 1) offsets.push([ring, y])
  for (let x = ring - 1; x >= -ring; x -= 1) offsets.push([x, ring])
  for (let y = ring - 1; y > -ring; y -= 1) offsets.push([-ring, y])
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

export function canvasContentBounds(state: InfiniteCanvasState): CanvasRect | null {
  const rects = [
    ...state.windows.map((window) => window.bounds),
    ...state.cards.map((card) => card.bounds),
  ]
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseRect(value: unknown): CanvasRect | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CanvasRect>
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
  if (!value || typeof value !== 'object') return undefined
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
  const match = /^canvas-(?:window|card|connector)-(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export function parseInfiniteCanvasState(value: unknown): InfiniteCanvasState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<InfiniteCanvasState>
  if (raw.version !== CANVAS_SCHEMA_VERSION || !Array.isArray(raw.windows)) {
    return null
  }
  const itemIds = new Set<string>()
  const windows: CanvasWindow[] = []
  for (const value of raw.windows) {
    if (!value || typeof value !== 'object') continue
    const window = value as Partial<CanvasWindow>
    const bounds = parseRect(window.bounds)
    const definition = window.definition
    if (
      !bounds ||
      typeof window.id !== 'string' ||
      itemIds.has(window.id) ||
      !definition ||
      typeof definition !== 'object'
    )
      continue
    if (
      definition.id !== window.id ||
      (definition.type !== 'browser' &&
        definition.type !== 'viewer' &&
        definition.type !== 'hermes')
    )
      continue
    itemIds.add(window.id)
    const initialStateRaw =
      definition.initialState && typeof definition.initialState === 'object'
        ? definition.initialState
        : {}
    windows.push({
      id: window.id,
      definition: {
        ...definition,
        title: typeof definition.title === 'string' ? definition.title : window.id,
        source: { kind: 'local' },
        initialState: {
          ...(typeof initialStateRaw.dir === 'string' ? { dir: initialStateRaw.dir } : {}),
          ...(typeof initialStateRaw.viewing === 'string'
            ? { viewing: initialStateRaw.viewing }
            : {}),
        },
        ...(definition.type === 'hermes' && typeof definition.hermes?.sessionId === 'string'
          ? {
              hermes: {
                sessionId: definition.hermes.sessionId,
                readOnly: !!definition.hermes.readOnly,
              },
            }
          : {}),
        tabGroupId: null,
      },
      bounds,
      zIndex: Math.max(1, Math.floor(finiteNumber(window.zIndex, 1))),
      locked: !!window.locked,
    })
  }
  const cards: CanvasCard[] = []
  for (const value of Array.isArray(raw.cards) ? raw.cards : []) {
    if (!value || typeof value !== 'object') continue
    const card = value as Partial<CanvasCard>
    const legacyKind = (value as { kind?: unknown }).kind
    const bounds = parseRect(card.bounds)
    if (
      !bounds ||
      typeof card.id !== 'string' ||
      itemIds.has(card.id) ||
      (legacyKind !== 'note' && legacyKind !== 'prompt' && legacyKind !== 'link')
    )
      continue
    const url = typeof card.url === 'string' && /^https?:\/\//i.test(card.url) ? card.url : null
    itemIds.add(card.id)
    cards.push({
      id: card.id,
      kind: 'note',
      title:
        typeof card.title === 'string' && card.title
          ? card.title.slice(0, 160)
          : legacyKind === 'link' && url
            ? url.slice(0, 160)
            : '',
      body: `${typeof card.body === 'string' ? card.body : ''}${legacyKind === 'link' && url ? `\n\n${url}` : ''}`.slice(
        0,
        250_000,
      ),
      url: null,
      color: typeof card.color === 'string' ? card.color : '#6366f1',
      bounds,
      zIndex: Math.max(1, Math.floor(finiteNumber(card.zIndex, 1))),
      locked: !!card.locked,
      tags: Array.isArray(card.tags)
        ? card.tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim().slice(0, 40))
            .filter(Boolean)
            .slice(0, 20)
        : [],
    })
  }
  const connectors: CanvasConnector[] = []
  const connectableIds = new Set([...windows, ...cards].map((item) => item.id))
  for (const value of Array.isArray(raw.connectors) ? raw.connectors : []) {
    if (!value || typeof value !== 'object') continue
    const connector = value as Partial<CanvasConnector>
    if (
      typeof connector.id !== 'string' ||
      itemIds.has(connector.id) ||
      typeof connector.fromId !== 'string' ||
      typeof connector.toId !== 'string' ||
      connector.fromId === connector.toId ||
      !connectableIds.has(connector.fromId) ||
      !connectableIds.has(connector.toId)
    )
      continue
    itemIds.add(connector.id)
    connectors.push({
      id: connector.id,
      fromId: connector.fromId,
      toId: connector.toId,
      label: typeof connector.label === 'string' ? connector.label.slice(0, 120) : '',
      color: typeof connector.color === 'string' ? connector.color : '#64748b',
    })
  }
  const cameraRaw = raw.camera as Partial<CanvasCamera> | undefined
  const sizesRaw = raw.windowSizeByType as
    | Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
    | undefined
  const sizeKeys: CanvasWindowSizeKey[] = [
    'browser',
    'viewer',
    'hermes',
    'viewer-audio',
    'viewer-video',
    'viewer-image',
    'viewer-text',
    'viewer-pdf',
    'viewer-other',
  ]
  const windowSizeByType = Object.fromEntries(
    sizeKeys.flatMap((key) => {
      const size = parseWindowSize(sizesRaw?.[key])
      return size ? [[key, size]] : []
    }),
  ) as Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
  const nextItemId = Math.max(0, ...Array.from(itemIds, canvasItemNumber)) + 1
  const nextZIndex =
    Math.max(0, ...windows.map((window) => window.zIndex), ...cards.map((card) => card.zIndex)) + 1
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows,
    cards,
    connectors,
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

export function loadInfiniteCanvasState(storage: Pick<Storage, 'getItem'>): InfiniteCanvasState {
  try {
    const raw = storage.getItem(CANVAS_STORAGE_KEY)
    if (!raw) return createEmptyCanvasState()
    return parseInfiniteCanvasState(JSON.parse(raw)) ?? createEmptyCanvasState()
  } catch {
    return createEmptyCanvasState()
  }
}

export function serializeInfiniteCanvasState(state: InfiniteCanvasState): string {
  return JSON.stringify({
    ...state,
    windows: state.windows
      .filter(
        (window) => window.definition.type !== 'hermes' || !!window.definition.hermes?.sessionId,
      )
      .filter(
        (window) =>
          window.definition.type !== 'hermes' ||
          !window.definition.hermes?.sessionId ||
          !deletedHermesSessionIds.has(window.definition.hermes.sessionId),
      )
      .map((window) => {
        if (window.definition.type !== 'hermes') return window
        const { draftId: _draftId, ...hermes } = window.definition.hermes ?? {}
        return { ...window, definition: { ...window.definition, hermes } }
      }),
  })
}
