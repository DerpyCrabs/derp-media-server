import { api, post } from './api'
import type {
  AutoSaveRequest,
  CopyFileRequest,
  CreateFileRequest,
  CustomIconRequest,
  EditFileRequest,
  FileListResponse,
  FileMutationResponse,
  FilePathRequest,
  FileSettingRequest,
  RemoveCustomIconRequest,
  RenameFileRequest,
  ServerConfigDto,
  SettingsDto,
  SettingsMutationResponse,
  UploadResponse,
  ViewModeRequest,
  WorkspaceLayoutPresetsRequest,
  WorkspaceTaskbarPinsRequest,
} from './generated/api-contracts'
import { apiRoutes } from './generated/api-contracts'
import type { FileSearchResponse, FileSearchStatus } from './file-search'

const FILE_SEARCH_PATH = '/api/files/search'
const STATS_PATH = '/api/stats/views'

export type StatsResponse = { views: Record<string, number> }
export type AddViewResponse = { success: boolean; viewCount: number }

export type FileListParameters = {
  dir: string
  surface?: 'library' | 'workspace' | 'canvas'
  offset?: number
}

export function fileListUrl(parameters: FileListParameters): string {
  const search = new URLSearchParams()
  if (parameters.surface && (parameters.surface !== 'library' || (parameters.offset ?? 0) > 0)) {
    search.set('surface', parameters.surface)
  }
  search.set('dir', parameters.dir)
  if (parameters.offset) search.set('offset', String(parameters.offset))
  return `${apiRoutes.files}?${search.toString()}`
}

export function fileDownloadUrl(path: string): string {
  return `${apiRoutes.filesDownload}?path=${encodeURIComponent(path)}`
}

export function fileSearchUrl(query: string, limit: number): string {
  const search = new URLSearchParams({ q: query, limit: String(limit) })
  return `${FILE_SEARCH_PATH}?${search.toString()}`
}

export const apiEndpoints = {
  config: {
    get: () => api<ServerConfigDto>(apiRoutes.config),
  },
  files: {
    list: (parameters: FileListParameters, signal?: AbortSignal) =>
      api<FileListResponse>(fileListUrl(parameters), { signal }),
    create: (body: CreateFileRequest, signal?: AbortSignal) =>
      post<FileMutationResponse>(apiRoutes.filesCreate, body, signal),
    edit: (body: EditFileRequest, signal?: AbortSignal) =>
      post<FileMutationResponse>(apiRoutes.filesEdit, body, signal),
    delete: (body: FilePathRequest, signal?: AbortSignal) =>
      post<FileMutationResponse>(apiRoutes.filesDelete, body, signal),
    rename: (body: RenameFileRequest, signal?: AbortSignal) =>
      post<FileMutationResponse>(apiRoutes.filesRename, body, signal),
    copy: (body: CopyFileRequest, signal?: AbortSignal) =>
      post<FileMutationResponse>(apiRoutes.filesCopy, body, signal),
    upload: (body: FormData, signal?: AbortSignal) =>
      api<UploadResponse>(apiRoutes.filesUpload, { method: 'POST', body, signal }),
    downloadUrl: fileDownloadUrl,
  },
  settings: {
    get: () => api<SettingsDto>(apiRoutes.settings),
    setViewMode: (body: ViewModeRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsViewMode, body),
    toggleFavorite: (body: FileSettingRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsFavorite, body),
    toggleKnowledgeBase: (body: FileSettingRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsKnowledgeBase, body),
    setCustomIcon: (body: CustomIconRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsIcon, body),
    removeCustomIcon: (body: RemoveCustomIconRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsIconRemove, body),
    setAutoSave: (body: AutoSaveRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsAutoSave, body),
    setWorkspaceTaskbarPins: (body: WorkspaceTaskbarPinsRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsTaskbarPins, body),
    setWorkspaceLayoutPresets: (body: WorkspaceLayoutPresetsRequest) =>
      post<SettingsMutationResponse>(apiRoutes.settingsLayoutPresets, body),
  },
  fileSearch: {
    search: (query: string, limit: number, signal?: AbortSignal) =>
      api<FileSearchResponse>(fileSearchUrl(query, limit), { signal }),
    status: () => api<FileSearchStatus>(`${FILE_SEARCH_PATH}/status`),
    reindex: (mode: 'reconcile' | 'full') =>
      post<{ accepted: true }>(`${FILE_SEARCH_PATH}/reindex`, { mode }),
  },
  stats: {
    get: () => api<StatsResponse>(STATS_PATH),
    addView: (filePath: string) => post<AddViewResponse>(STATS_PATH, { filePath }),
  },
  events: {
    streamUrl: apiRoutes.events,
  },
} as const
