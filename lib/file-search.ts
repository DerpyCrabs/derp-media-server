import { MediaType, type FileItem } from './types'

export const FILE_SEARCH_MIN_QUERY_LENGTH = 3
export const FILE_SEARCH_MAX_QUERY_LENGTH = 200
export const FILE_SEARCH_DEFAULT_LIMIT = 50
export const FILE_SEARCH_MAX_LIMIT = 100

export type FileSearchRootState =
  | 'building'
  | 'ready'
  | 'refreshing'
  | 'partial'
  | 'offline'
  | 'error'
export type FileSearchRefreshMode = 'recursive-watch' | 'polling' | 'degraded'

export interface FileSearchRootStatus {
  id: string
  name: string
  state: FileSearchRootState
  refreshMode: FileSearchRefreshMode
  indexedEntries: number
  scannedDirectories: number
  lastCompleteAt: number | null
  error?: string
}

export interface FileSearchStatus {
  state: 'starting' | 'building' | 'ready' | 'refreshing' | 'partial' | 'error' | 'disabled'
  stale: boolean
  indexedEntries: number
  scannedDirectories: number
  watcherCount: number
  roots: FileSearchRootStatus[]
  error?: string
}

export interface FileSearchResult {
  name: string
  path: string
  parentPath: string
  rootId: string
  rootName: string
  isDirectory: boolean
  extension: string
  type: MediaType
}

export interface FileSearchResponse {
  results: FileSearchResult[]
  truncated: boolean
  status: FileSearchStatus
}

export function normalizeFileSearchText(value: string): string {
  return value.replace(/\\/g, '/').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

export function fileSearchCodePointLength(value: string): number {
  return Array.from(value).length
}

export function fileSearchResultToFileItem(result: FileSearchResult): FileItem {
  return {
    name: result.name,
    path: result.path,
    type: result.isDirectory ? MediaType.FOLDER : result.type,
    size: 0,
    extension: result.extension,
    isDirectory: result.isDirectory,
  }
}
