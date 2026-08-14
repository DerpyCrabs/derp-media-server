import { apiEndpoints } from './api-endpoints'

export function fileDownloadHref(path: string): string {
  return apiEndpoints.files.downloadUrl(path)
}
