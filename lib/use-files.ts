'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileItem } from './types'
import { VIRTUAL_FOLDERS } from './constants'

async function fetchFiles(path: string): Promise<FileItem[]> {
  // Handle virtual folders
  if (path === VIRTUAL_FOLDERS.MOST_PLAYED) {
    const response = await fetch('/api/stats/most-played')
    if (!response.ok) {
      throw new Error('Failed to fetch most played files')
    }
    const data = await response.json()
    return data.files
  }

  if (path === VIRTUAL_FOLDERS.FAVORITES) {
    const response = await fetch('/api/stats/favorites')
    if (!response.ok) {
      throw new Error('Failed to fetch favorites')
    }
    const data = await response.json()
    return data.files
  }

  if (path === VIRTUAL_FOLDERS.SHARES) {
    const response = await fetch('/api/shares/files')
    if (!response.ok) {
      throw new Error('Failed to fetch shares')
    }
    const data = await response.json()
    return data.files
  }

  // Handle regular folders
  const response = await fetch(`/api/files?dir=${encodeURIComponent(path)}`)
  if (!response.ok) {
    throw new Error('Failed to fetch files')
  }
  const data = await response.json()
  return data.files
}

export function useFiles(currentPath: string, initialData?: FileItem[]) {
  return useQuery({
    queryKey: ['files', currentPath],
    queryFn: () => fetchFiles(currentPath),
    staleTime: 1000 * 30, // Consider data fresh for 30s; SSE events drive invalidation
    gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
    initialData: initialData, // Use SSR data if available
    enabled: true, // Always enabled
    refetchOnWindowFocus: true, // Refetch when user returns to tab
  })
}

// Hook for prefetching files on hover
export function usePrefetchFiles() {
  const queryClient = useQueryClient()

  return (path: string) => {
    queryClient.prefetchQuery({
      queryKey: ['files', path],
      queryFn: () => fetchFiles(path),
      staleTime: 1000 * 60 * 2,
    })
  }
}
