'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileItem } from './types'

async function fetchFiles(path: string): Promise<FileItem[]> {
  const response = await fetch(`/api/files?dir=${encodeURIComponent(path)}`)
  if (!response.ok) {
    throw new Error('Failed to fetch files')
  }
  return response.json()
}

export function useFiles(currentPath: string, initialData?: FileItem[]) {
  return useQuery({
    queryKey: ['files', currentPath],
    queryFn: () => fetchFiles(currentPath),
    staleTime: 1000 * 60 * 2, // Consider data fresh for 2 minutes
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
