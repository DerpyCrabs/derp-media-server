import { apiRoutes } from '@/lib/generated/api-contracts'
import { filesystemResourceKeyForPath } from './resource'

export function filesystemDownloadHref(path: string): string {
  const key = filesystemResourceKeyForPath(path)
  return `${apiRoutes.integrations}/filesystem/download?${new URLSearchParams({ id: key.id })}`
}
