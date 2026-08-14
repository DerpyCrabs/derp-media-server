import { api, post } from './api'
import type {
  AutoSaveRequest,
  CustomIconRequest,
  FileSettingRequest,
  RemoveCustomIconRequest,
  ServerConfigDto,
  SettingsDto,
  SettingsMutationResponse,
  ViewModeRequest,
  WorkspaceLayoutPresetsRequest,
  WorkspaceTaskbarPinsRequest,
} from './generated/api-contracts'
import { apiRoutes } from './generated/api-contracts'
const STATS_PATH = '/api/stats/views'
const READER_STATE_PATH = '/api/reader-state'
const READER_PREFERENCES_PATH = '/api/reader-preferences'

export type StatsResponse = { views: Record<string, number> }
export type AddViewResponse = { success: boolean; viewCount: number }

export function readerStateUrl(path: string): string {
  return `${READER_STATE_PATH}?${new URLSearchParams({ path })}`
}

export const apiEndpoints = {
  config: {
    get: () => api<ServerConfigDto>(apiRoutes.config),
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
  reader: {
    loadState: <T>(path: string) => api<T>(readerStateUrl(path)),
    saveState: <T>(body: unknown) => post<T>(READER_STATE_PATH, body),
    loadPreferences: <T>() => api<T>(READER_PREFERENCES_PATH),
    savePreferences: <T>(body: unknown) => post<T>(READER_PREFERENCES_PATH, body),
  },
  stats: {
    get: () => api<StatsResponse>(STATS_PATH),
    addView: (filePath: string) => post<AddViewResponse>(STATS_PATH, { filePath }),
  },
  events: {
    streamUrl: apiRoutes.events,
  },
} as const
