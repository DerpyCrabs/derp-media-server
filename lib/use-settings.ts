'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { AutoSaveSettings } from './types'

export type ViewMode = 'list' | 'grid'

interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
}

// Fetch full settings file
async function fetchAllSettings(): Promise<GlobalSettings> {
  const response = await fetch(`/api/settings/all`)
  if (!response.ok) {
    // Fallback to empty settings
    return { viewModes: {}, favorites: [], knowledgeBases: [], customIcons: {}, autoSave: {} }
  }
  return response.json()
}

// Save view mode
async function saveViewMode(path: string, viewMode: ViewMode) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, viewMode }),
  })
  if (!response.ok) {
    throw new Error('Failed to save view mode')
  }
  return response.json()
}

// Toggle favorite
async function toggleFavorite(filePath: string) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'toggleFavorite', filePath }),
  })
  if (!response.ok) {
    throw new Error('Failed to toggle favorite')
  }
  return response.json()
}

// Toggle knowledge base
async function toggleKnowledgeBase(filePath: string) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'toggleKnowledgeBase', filePath }),
  })
  if (!response.ok) {
    throw new Error('Failed to toggle knowledge base')
  }
  return response.json()
}

// Set custom icon
async function setCustomIcon(path: string, iconName: string) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setCustomIcon', path, iconName }),
  })
  if (!response.ok) {
    throw new Error('Failed to set custom icon')
  }
  return response.json()
}

// Remove custom icon
async function removeCustomIcon(path: string) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'removeCustomIcon', path }),
  })
  if (!response.ok) {
    throw new Error('Failed to remove custom icon')
  }
  return response.json()
}

// Set auto-save for file
async function setAutoSave(filePath: string, enabled: boolean, readOnly?: boolean) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setAutoSave', filePath, enabled, readOnly }),
  })
  if (!response.ok) {
    throw new Error('Failed to set auto-save setting')
  }
  return response.json()
}

// Singleton EventSource to prevent multiple connections
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
          // Refetch all settings queries when settings change
          queryClient.invalidateQueries({ queryKey: ['settings'] })
        }
      } catch (error) {
        console.error('[Settings SSE] Error parsing message:', error)
      }
    }

    globalEventSource.onerror = (error) => {
      console.warn('[Settings SSE] Connection error:', error)
      // Close and reset
      if (globalEventSource) {
        globalEventSource.close()
        globalEventSource = null
      }
      // Try to reconnect after 5 seconds
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

// Hook to manage settings with SSE and optimistic updates
export function useSettings(currentPath: string, enabled = true) {
  const queryClient = useQueryClient()

  const { data: globalSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchAllSettings,
    staleTime: Infinity, // Don't auto-refetch, rely on SSE
    enabled,
  })

  useEffect(() => {
    if (!enabled) return
    connectToSSE(queryClient)
    return () => {
      disconnectFromSSE()
    }
  }, [queryClient, enabled])

  // Mutation for view mode with optimistic update
  const viewModeMutation = useMutation({
    mutationFn: ({ path, viewMode }: { path: string; viewMode: ViewMode }) =>
      saveViewMode(path, viewMode),
    onMutate: async ({ path, viewMode }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      // Snapshot previous value
      const previousSettings = queryClient.getQueryData<GlobalSettings>(['settings'])

      // Optimistically update
      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
        if (!old)
          return {
            viewModes: { [path]: viewMode },
            favorites: [],
            knowledgeBases: [],
            customIcons: {},
            autoSave: {},
          }
        return {
          ...old,
          viewModes: { ...old.viewModes, [path]: viewMode },
        }
      })

      return { previousSettings }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      // Refetch after mutation (will be fast due to SSE)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  // Mutation for favorites with optimistic update
  const favoriteMutation = useMutation({
    mutationFn: (filePath: string) => toggleFavorite(filePath),
    onMutate: async (filePath) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      const previousSettings = queryClient.getQueryData<GlobalSettings>(['settings'])

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

        return {
          viewModes: old.viewModes,
          favorites,
          knowledgeBases: old.knowledgeBases || [],
          customIcons: old.customIcons || {},
          autoSave: old.autoSave || {},
        }
      })

      return { previousSettings }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  // Mutation for toggling knowledge base with optimistic update
  const knowledgeBaseMutation = useMutation({
    mutationFn: (filePath: string) => toggleKnowledgeBase(filePath),
    onMutate: async (filePath) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      const previousSettings = queryClient.getQueryData<GlobalSettings>(['settings'])

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

        return {
          viewModes: old.viewModes,
          favorites: old.favorites || [],
          knowledgeBases,
          customIcons: old.customIcons || {},
          autoSave: old.autoSave || {},
        }
      })

      return { previousSettings }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  // Mutation for setting custom icon with optimistic update
  const setIconMutation = useMutation({
    mutationFn: ({ path, iconName }: { path: string; iconName: string }) =>
      setCustomIcon(path, iconName),
    onMutate: async ({ path, iconName }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      const previousSettings = queryClient.getQueryData<GlobalSettings>(['settings'])

      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [],
            knowledgeBases: [],
            customIcons: { [path]: iconName },
            autoSave: {},
          }
        return {
          ...old,
          customIcons: { ...old.customIcons, [path]: iconName },
        }
      })

      return { previousSettings }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  // Mutation for removing custom icon with optimistic update
  const removeIconMutation = useMutation({
    mutationFn: (path: string) => removeCustomIcon(path),
    onMutate: async (path) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      const previousSettings = queryClient.getQueryData<GlobalSettings>(['settings'])

      queryClient.setQueryData<GlobalSettings>(['settings'], (old) => {
        if (!old)
          return { viewModes: {}, favorites: [], knowledgeBases: [], customIcons: {}, autoSave: {} }
        const customIcons = { ...old.customIcons }
        delete customIcons[path]
        return { ...old, customIcons }
      })

      return { previousSettings }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  // Mutation for auto-save setting with optimistic update
  const autoSaveMutation = useMutation({
    mutationFn: ({
      filePath,
      enabled,
      readOnly,
    }: {
      filePath: string
      enabled: boolean
      readOnly?: boolean
    }) => setAutoSave(filePath, enabled, readOnly),
    onMutate: async ({ filePath, enabled, readOnly }) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      const previousSettings = queryClient.getQueryData<GlobalSettings>(['settings'])

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
            [filePath]: {
              enabled,
              ...(readOnly !== undefined && { readOnly }),
            },
          },
        }
      })

      return { previousSettings }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  // Extract current path settings from global settings
  const viewMode = globalSettings?.viewModes[currentPath] || 'list'
  const favorites = globalSettings?.favorites || []
  const knowledgeBases = globalSettings?.knowledgeBases || []
  const customIcons = globalSettings?.customIcons || {}
  const autoSave = globalSettings?.autoSave || {}

  return {
    settings: { viewMode, favorites, knowledgeBases, customIcons, autoSave },
    setViewMode: (viewMode: ViewMode) => viewModeMutation.mutate({ path: currentPath, viewMode }),
    toggleFavorite: (filePath: string) => favoriteMutation.mutate(filePath),
    toggleKnowledgeBase: (filePath: string) => knowledgeBaseMutation.mutate(filePath),
    setCustomIcon: (path: string, iconName: string) => setIconMutation.mutate({ path, iconName }),
    removeCustomIcon: (path: string) => removeIconMutation.mutate(path),
    setAutoSave: (filePath: string, enabled: boolean, readOnly?: boolean) =>
      autoSaveMutation.mutate({ filePath, enabled, readOnly }),
    isLoading: !globalSettings,
  }
}
