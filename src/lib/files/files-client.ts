import { apiSchemaEffect, type ApiRequestOptions } from '@/lib/api/client'
import { directoryFilesSchema } from './file-schemas'

export type DirectoryFilesResponse = typeof directoryFilesSchema.Type

export function fetchDirectoryFilesEffect(path: string, options?: ApiRequestOptions) {
  return apiSchemaEffect(
    directoryFilesSchema,
    `/api/files?dir=${encodeURIComponent(path)}`,
    options,
  )
}
