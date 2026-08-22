export type ReaderViewMode = 'continuous' | 'page'
export type ReaderFitMode = 'manual' | 'width' | 'height'
export type ReaderSelectionMode = 'text' | 'image'
export type ReaderDefaultAction = 'define' | 'translate' | 'none'

export type PagedReaderPosition = {
  kind: 'paged'
  pageIndex: number
  scrollTop: number
  zoom: number
  viewMode: ReaderViewMode
  fitMode: ReaderFitMode
  outlineExpanded: string[]
}

export type BookReaderPosition = {
  kind: 'book'
  chapterId: string
  anchor?: string
  chapterProgress: number
  outlineExpanded: string[]
}

export type ReaderDocumentPosition = PagedReaderPosition | BookReaderPosition

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

export type ReaderPage = {
  id: string
  name: string
  source: string
  width: number
  height: number
  kind: 'pdf' | 'image'
}

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 2_000)
    : []

export function normalizePagedReaderPosition(value: unknown): PagedReaderPosition {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const legacy = normalizeReaderPosition(input)
  return {
    kind: 'paged',
    pageIndex: legacy.pageIndex,
    scrollTop: legacy.scrollTop,
    zoom: legacy.zoom,
    viewMode: legacy.viewMode,
    fitMode: legacy.fitMode,
    outlineExpanded: stringArray(input.outlineExpanded),
  }
}

export function normalizeBookReaderPosition(value: unknown): BookReaderPosition {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    kind: 'book',
    chapterId: typeof input.chapterId === 'string' ? input.chapterId.slice(0, 1_024) : '',
    anchor: typeof input.anchor === 'string' ? input.anchor.slice(0, 1_024) : undefined,
    chapterProgress: Math.max(0, Math.min(1, Number(input.chapterProgress) || 0)),
    outlineExpanded: stringArray(input.outlineExpanded),
  }
}
