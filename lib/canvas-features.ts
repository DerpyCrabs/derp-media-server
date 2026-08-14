import { parseInfiniteCanvasState, type InfiniteCanvasState } from './infinite-canvas'
import type { ContentWindowPersistencePort } from './content-window-persistence'

export type CanvasExportBundle = {
  kind: 'derp-canvas'
  version: 1
  name: string
  exportedAt: number
  state: InfiniteCanvasState
}

export function createCanvasExport(name: string, state: InfiniteCanvasState): CanvasExportBundle {
  return { kind: 'derp-canvas', version: 1, name, exportedAt: Date.now(), state }
}

export function parseCanvasExport(
  value: unknown,
  persistence: ContentWindowPersistencePort,
): CanvasExportBundle | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CanvasExportBundle>
  const state = parseInfiniteCanvasState(raw.state, persistence)
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
