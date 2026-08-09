import {
  parseInfiniteCanvasState,
  type CanvasRect,
  type InfiniteCanvasState,
} from './infinite-canvas'

export const CANVAS_SNAPSHOTS_STORAGE_KEY = 'infinite-canvas-snapshots-v1'

export type CanvasSnapshot = {
  id: string
  canvasId: string
  name: string
  createdAt: number
  state: InfiniteCanvasState
}

export type CanvasExportBundle = {
  kind: 'derp-canvas'
  version: 1
  name: string
  exportedAt: number
  state: InfiniteCanvasState
}

export function canvasItemBounds(state: InfiniteCanvasState, id: string): CanvasRect | null {
  const window = state.windows.find((item) => item.id === id)
  if (window) return window.bounds
  const card = state.cards.find((item) => item.id === id)
  return card?.bounds ?? null
}

export function buildCanvasContext(state: InfiniteCanvasState, ids: string[]): string {
  const selected = new Set(ids)
  const parts: string[] = ['# Canvas context']
  for (const card of state.cards.filter((item) => selected.has(item.id))) {
    parts.push(`\n## ${card.title || 'Note'}\n${card.body}`)
    if (card.url) parts.push(`\nURL: ${card.url}`)
    if (card.tags.length) parts.push(`\nTags: ${card.tags.join(', ')}`)
  }
  for (const window of state.windows.filter((item) => selected.has(item.id))) {
    const path = window.definition.initialState.viewing ?? window.definition.initialState.dir ?? ''
    parts.push(`\n## Source: ${window.definition.title}\n${path}`)
  }
  const links = state.connectors.filter(
    (item) => selected.has(item.fromId) && selected.has(item.toId),
  )
  if (links.length) {
    parts.push('\n## Relationships')
    for (const link of links)
      parts.push(`- ${link.fromId} -> ${link.toId}${link.label ? `: ${link.label}` : ''}`)
  }
  return parts.join('\n').trim()
}

export function createCanvasExport(name: string, state: InfiniteCanvasState): CanvasExportBundle {
  return { kind: 'derp-canvas', version: 1, name, exportedAt: Date.now(), state }
}

export function parseCanvasExport(value: unknown): CanvasExportBundle | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CanvasExportBundle>
  const state = parseInfiniteCanvasState(raw.state)
  if (raw.kind !== 'derp-canvas' || raw.version !== 1 || typeof raw.name !== 'string' || !state)
    return null
  return {
    kind: 'derp-canvas',
    version: 1,
    name: raw.name.slice(0, 120),
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
    state,
  }
}

export function parseCanvasSnapshots(value: string | null): CanvasSnapshot[] {
  if (!value) return []
  try {
    const raw = JSON.parse(value) as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const snapshot = value as Partial<CanvasSnapshot>
      const state = parseInfiniteCanvasState(snapshot.state)
      if (
        typeof snapshot.id !== 'string' ||
        typeof snapshot.canvasId !== 'string' ||
        typeof snapshot.name !== 'string' ||
        typeof snapshot.createdAt !== 'number' ||
        !state
      )
        return []
      return [{ ...snapshot, state } as CanvasSnapshot]
    })
  } catch {
    return []
  }
}
