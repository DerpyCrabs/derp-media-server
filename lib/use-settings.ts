import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useAdminEventsStream } from '@/lib/use-admin-events-stream'

import type { AutoSaveSettings } from './types'
import type { WorkspaceTaskbarPin } from './workspace-taskbar-pins'
import { VIRTUAL_FOLDERS } from './constants'

type ViewMode = 'list' | 'grid'

export interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
  workspaceTaskbarPins?: WorkspaceTaskbarPin[]
}

export function useSettings(currentPath: string, enabled = true) {
  const queryClient = useQueryClient()

  useAdminEventsStream(enabled)

  const { data: globalSettings } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled,
  })

  const viewModeMutation = useMutation({
    mutationFn: (vars: { path: string; viewMode: ViewMode }) =>
      post('/api/settings/viewMode', vars),
    onMutate: async ({ path, viewMode }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: { [path]: viewMode },
            favorites: [],
            knowledgeBases: [],
            customIcons: {},
            autoSave: {},
          }
        return { ...old, viewModes: { ...old.viewModes, [path]: viewMode } }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })

  const favoriteMutation = useMutation({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onMutate: async ({ filePath }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [filePath],
            knowledgeBases: [],
            customIcons: {},
            autoSave: {},
          }
        const favorites = [...old.favorites]
        const index = favorites.indexOf(filePath)
        if (index > -1) {
          favorites.splice(index, 1)
        } else {
          favorites.push(filePath)
        }
        return { ...old, favorites }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      queryClient.invalidateQueries({ queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES) })
    },
  })

  const knowledgeBaseMutation = useMutation({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/knowledgeBase', vars),
    onMutate: async ({ filePath }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [],
            knowledgeBases: [filePath],
            customIcons: {},
            autoSave: {},
          }
        const knowledgeBases = [...(old.knowledgeBases || [])]
        const index = knowledgeBases.indexOf(filePath)
        if (index > -1) {
          knowledgeBases.splice(index, 1)
        } else {
          knowledgeBases.push(filePath)
        }
        return { ...old, knowledgeBases }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })

  const setIconMutation = useMutation({
    mutationFn: (vars: { path: string; iconName: string }) => post('/api/settings/icon', vars),
    onMutate: async ({ path, iconName }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [],
            knowledgeBases: [],
            customIcons: { [path]: iconName },
            autoSave: {},
          }
        return { ...old, customIcons: { ...old.customIcons, [path]: iconName } }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })

  const removeIconMutation = useMutation({
    mutationFn: (vars: { path: string }) => post('/api/settings/icon/remove', vars),
    onMutate: async ({ path }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return { viewModes: {}, favorites: [], knowledgeBases: [], customIcons: {}, autoSave: {} }
        const customIcons = { ...old.customIcons }
        delete customIcons[path]
        return { ...old, customIcons }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })

  const autoSaveMutation = useMutation({
    mutationFn: (vars: { filePath: string; enabled: boolean; readOnly?: boolean }) =>
      post('/api/settings/autoSave', vars),
    onMutate: async ({ filePath, enabled, readOnly }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [],
            knowledgeBases: [],
            customIcons: {},
            autoSave: { [filePath]: { enabled, ...(readOnly !== undefined && { readOnly }) } },
          }
        return {
          ...old,
          autoSave: {
            ...old.autoSave,
            [filePath]: { enabled, ...(readOnly !== undefined && { readOnly }) },
          },
        }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })

  const viewMode = globalSettings?.viewModes[currentPath] || 'list'
  const favorites = globalSettings?.favorites || []
  const knowledgeBases = globalSettings?.knowledgeBases || []
  const customIcons = globalSettings?.customIcons || {}
  const autoSave = globalSettings?.autoSave || {}

  return {
    settings: { viewMode, favorites, knowledgeBases, customIcons, autoSave },
    setViewMode: (viewMode: ViewMode) => viewModeMutation.mutate({ path: currentPath, viewMode }),
    toggleFavorite: (filePath: string) => favoriteMutation.mutate({ filePath }),
    toggleKnowledgeBase: (filePath: string) => knowledgeBaseMutation.mutate({ filePath }),
    setCustomIcon: (path: string, iconName: string) => setIconMutation.mutate({ path, iconName }),
    removeCustomIcon: (path: string) => removeIconMutation.mutate({ path }),
    setAutoSave: (filePath: string, enabled: boolean, readOnly?: boolean) =>
      autoSaveMutation.mutate({ filePath, enabled, readOnly }),
    isLoading: !globalSettings,
  }
}
