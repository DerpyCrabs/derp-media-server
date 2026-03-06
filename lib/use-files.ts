import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { FileItem } from './types'

function stripSharePrefix(filePath: string, sharePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const base = sharePath.replace(/\\/g, '/')
  if (norm === base) return ''
  return norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm
}

export function useFiles(
  currentPath: string,
  shareToken?: string | null,
  sharePath?: string | null,
) {
  const dir = shareToken && sharePath ? stripSharePrefix(currentPath, sharePath) : currentPath

  const { data, ...rest } = useQuery({
    queryKey: shareToken ? ['share-files', shareToken, dir] : ['files', currentPath],
    queryFn: () =>
      shareToken
        ? api<{ files: FileItem[] }>(
            `/api/share/${shareToken}/files?dir=${encodeURIComponent(dir)}`,
          )
        : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentPath)}`),
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
