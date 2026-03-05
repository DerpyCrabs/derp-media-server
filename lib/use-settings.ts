import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, post } from '@/lib/api'

import type { AutoSaveSettings } from './types'

export type ViewMode = 'list' | 'grid'

interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
}

let globalEventSource: EventSource | null = null
let connectionRefCount = 0

function connectToSSE(queryClient: ReturnType<typeof useQueryClient>) {
  if (!globalEventSource) {
    console.log('[Settings SSE] Connecting to settings stream...')
    globalEventSource = new EventSource('/api/settings/stream')

    globalEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'connected') {
          console.log('[Settings SSE] Connected to settings stream')
        } else if (data.type === 'settings-changed') {
          console.log('[Settings SSE] Settings changed, refetching...')
          queryClient.invalidateQueries({ queryKey: ['settings'] })
        }
      } catch (error) {
        console.error('[Settings SSE] Error parsing message:', error)
      }
    }

    globalEventSource.onerror = (error) => {
      console.warn('[Settings SSE] Connection error:', error)
      if (globalEventSource) {
        globalEventSource.close()
        globalEventSource = null
      }
      setTimeout(() => {
        if (connectionRefCount > 0) {
          console.log('[Settings SSE] Reconnecting...')
          connectToSSE(queryClient)
        }
      }, 5000)
    }
  }
  connectionRefCount++
}

function disconnectFromSSE() {
  connectionRefCount--
  if (connectionRefCount === 0 && globalEventSource) {
    console.log('[Settings SSE] Closing connection')
    globalEventSource.close()
    globalEventSource = null
  }
}

export function useSettings(currentPath: string, enabled = true) {
  const queryClient = useQueryClient()

  const { data: globalSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled,
  })

  useEffect(() => {
    if (!enabled) return
    connectToSSE(queryClient)
    return () => {
      disconnectFromSSE()
    }
  }, [queryClient, enabled])

  const viewModeMutation = useMutation({
    mutationFn: (vars: { path: string; viewMode: ViewMode }) =>
      post('/api/settings/viewMode', vars),
    onMutate: async ({ path, viewMode }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<GlobalSettings>(['settings'])
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
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
      if (context?.prev) queryClient.setQueryData(['settings'], context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const favoriteMutation = useMutation({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onMutate: async ({ filePath }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<GlobalSettings>(['settings'])
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
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
      if (context?.prev) queryClient.setQueryData(['settings'], context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['files', 'Favorites'] })
    },
  })

  const knowledgeBaseMutation = useMutation({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/knowledgeBase', vars),
    onMutate: async ({ filePath }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<GlobalSettings>(['settings'])
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
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
      if (context?.prev) queryClient.setQueryData(['settings'], context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const setIconMutation = useMutation({
    mutationFn: (vars: { path: string; iconName: string }) => post('/api/settings/icon', vars),
    onMutate: async ({ path, iconName }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<GlobalSettings>(['settings'])
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
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
      if (context?.prev) queryClient.setQueryData(['settings'], context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const removeIconMutation = useMutation({
    mutationFn: (vars: { path: string }) => post('/api/settings/icon/remove', vars),
    onMutate: async ({ path }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<GlobalSettings>(['settings'])
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
        if (!old)
          return { viewModes: {}, favorites: [], knowledgeBases: [], customIcons: {}, autoSave: {} }
        const customIcons = { ...old.customIcons }
        delete customIcons[path]
        return { ...old, customIcons }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['settings'], context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const autoSaveMutation = useMutation({
    mutationFn: (vars: { filePath: string; enabled: boolean; readOnly?: boolean }) =>
      post('/api/settings/autoSave', vars),
    onMutate: async ({ filePath, enabled, readOnly }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<GlobalSettings>(['settings'])
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
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
      if (context?.prev) queryClient.setQueryData(['settings'], context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
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
