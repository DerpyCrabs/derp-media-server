import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { FileItem } from './types'
import { resolveSourceContext, stripSharePrefix, type SourceContext } from '@/lib/source-context'
import { queryKeys } from '@/lib/query-keys'

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
    queryKey: shareToken
      ? queryKeys.shareFiles(shareToken, currentDir)
      : queryKeys.files(currentPath),
    queryFn: () =>
      shareToken
        ? api<{ files: FileItem[] }>(
            `/api/share/${shareToken}/files?dir=${encodeURIComponent(currentDir)}`,
          )
        : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentPath)}`),
  })
  return { data: data?.files, ...rest }
}
