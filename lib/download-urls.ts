export function fileDownloadHref(path: string): string {
  return `/api/files/download?path=${encodeURIComponent(path)}`
}
