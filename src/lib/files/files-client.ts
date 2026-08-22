import { api } from '@/lib/api/client'
import type { FileItem } from './types'

export type DirectoryFilesResponse = { files: FileItem[] }

export function fetchDirectoryFiles(path: string): Promise<DirectoryFilesResponse> {
  return api<DirectoryFilesResponse>(`/api/files?dir=${encodeURIComponent(path)}`)
}
