import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/solid-query'
import { apiEndpoints } from './api-endpoints'
import type {
  AutoSaveRequest,
  CustomIconRequest,
  FileSettingRequest,
  RemoveCustomIconRequest,
  ViewModeRequest,
  WorkspaceLayoutPresetsRequest,
  WorkspaceTaskbarPinsRequest,
} from './generated/api-contracts'
import { queryKeys } from './query-keys'
import { persistViewMode } from './view-mode-persistence'

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.serverConfig(),
    queryFn: apiEndpoints.config.get,
    staleTime: Infinity,
  })
}

export function settingsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.settings(),
    queryFn: apiEndpoints.settings.get,
    staleTime: Infinity,
  })
}

export function statsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.stats(),
    queryFn: apiEndpoints.stats.get,
  })
}

export function invalidateFileQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.files() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.applicationContent() }),
  ])
}

export function invalidateSettingsQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
}

export function invalidateFavoriteQueries(queryClient: QueryClient) {
  return Promise.all([
    invalidateSettingsQueries(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.files() }),
  ])
}

export const settingsMutationOptions = {
  viewMode: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: ViewModeRequest) => persistViewMode(body.path, body.viewMode),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
  favorite: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: FileSettingRequest) => apiEndpoints.settings.toggleFavorite(body),
      onSettled: () => invalidateFavoriteQueries(queryClient),
    }),
  knowledgeBase: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: FileSettingRequest) => apiEndpoints.settings.toggleKnowledgeBase(body),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
  customIcon: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: CustomIconRequest) => apiEndpoints.settings.setCustomIcon(body),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
  removeCustomIcon: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: RemoveCustomIconRequest) => apiEndpoints.settings.removeCustomIcon(body),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
  autoSave: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: AutoSaveRequest) => apiEndpoints.settings.setAutoSave(body),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
  workspaceTaskbarPins: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: WorkspaceTaskbarPinsRequest) =>
        apiEndpoints.settings.setWorkspaceTaskbarPins(body),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
  workspaceLayoutPresets: (queryClient: QueryClient) =>
    mutationOptions({
      mutationFn: (body: WorkspaceLayoutPresetsRequest) =>
        apiEndpoints.settings.setWorkspaceLayoutPresets(body),
      onSettled: () => invalidateSettingsQueries(queryClient),
    }),
} as const
