import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { FileItem } from './types'

export function useFiles(currentPath: string) {
  const { data, ...rest } = useQuery({
    queryKey: ['files', currentPath],
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentPath)}`),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  })
  return { data: data?.files, ...rest }
}

export function usePrefetchFiles() {
  const queryClient = useQueryClient()
  return (path: string) => {
    queryClient.prefetchQuery({
      queryKey: ['files', path],
      queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(path)}`),
      staleTime: 1000 * 60 * 2,
    })
  }
}
