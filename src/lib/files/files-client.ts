import { api } from '@/lib/api/client'
import type { FileItem } from './types'

export type DirectoryFilesResponse = { files: FileItem[] }

export function fetchDirectoryFiles(
  path: string,
  signal?: AbortSignal,
): Promise<DirectoryFilesResponse> {
  return api<DirectoryFilesResponse>(`/api/files?dir=${encodeURIComponent(path)}`, { signal })
}
