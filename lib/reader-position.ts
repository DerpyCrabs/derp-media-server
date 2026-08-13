export type ReaderViewMode = 'continuous' | 'page'
export type ReaderFitMode = 'manual' | 'width' | 'height'
export type ReaderSelectionMode = 'text' | 'image'
export type ReaderDefaultAction = 'define' | 'translate' | 'none'

export type ReaderPosition = {
  pageIndex: number
  scrollTop: number
  zoom: number
  viewMode: ReaderViewMode
  fitMode: ReaderFitMode
  selectionMode: ReaderSelectionMode
  defaultAction: ReaderDefaultAction
}

export const DEFAULT_READER_POSITION: ReaderPosition = {
  pageIndex: 0,
  scrollTop: 0,
  zoom: 1,
  viewMode: 'continuous',
  fitMode: 'manual',
  selectionMode: 'text',
  defaultAction: 'define',
}

const storageKey = (path: string) => `derp.reader.position.v2:${path.replace(/\\/g, '/')}`

export function normalizeReaderPosition(value: unknown): ReaderPosition {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<ReaderPosition>
  return {
    pageIndex: Math.max(0, Math.floor(Number(input.pageIndex) || 0)),
    scrollTop: Math.max(0, Number(input.scrollTop) || 0),
    zoom: Math.max(0.35, Math.min(3, Number(input.zoom) || 1)),
    viewMode: input.viewMode === 'page' ? 'page' : 'continuous',
    fitMode: input.fitMode === 'width' || input.fitMode === 'height' ? input.fitMode : 'manual',
    selectionMode: input.selectionMode === 'image' ? 'image' : 'text',
    defaultAction:
      input.defaultAction === 'translate' || input.defaultAction === 'none'
        ? input.defaultAction
        : 'define',
  }
}

export function parseReaderPosition(value: string | null): ReaderPosition {
  if (!value) return { ...DEFAULT_READER_POSITION }
  try {
    return normalizeReaderPosition(JSON.parse(value))
  } catch {
    return { ...DEFAULT_READER_POSITION }
  }
}

export function loadReaderPosition(path: string): ReaderPosition {
  return parseReaderPosition(localStorage.getItem(storageKey(path)))
}

export function saveReaderPosition(path: string, position: ReaderPosition): void {
  localStorage.setItem(storageKey(path), JSON.stringify(position))
}

export function clearReaderPosition(path: string): void {
  localStorage.removeItem(storageKey(path))
}
