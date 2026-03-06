import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { FileItem } from './types'
import { resolveSourceContext, stripSharePrefix, type SourceContext } from '@/lib/source-context'

export function useFiles(
  currentPath: string,
  sourceOrToken?: SourceContext | string | null,
  sharePath?: string | null,
) {
  const source = resolveSourceContext(sourceOrToken, sharePath)
  const shareToken = source.shareToken ?? null
  const resolvedSharePath = source.sharePath ?? null
  const currentDir =
    shareToken && resolvedSharePath ? stripSharePrefix(currentPath, resolvedSharePath) : currentPath

  const { data, ...rest } = useQuery({
    queryKey: shareToken ? ['share-files', shareToken, currentDir] : ['files', currentPath],
    queryFn: () =>
      shareToken
        ? api<{ files: FileItem[] }>(
            `/api/share/${shareToken}/files?dir=${encodeURIComponent(currentDir)}`,
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
