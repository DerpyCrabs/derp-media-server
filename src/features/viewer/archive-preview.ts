import { Effect } from 'effect'
import { ApiError } from '@/lib/api/client'
export type ArchivePreviewKind = 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'binary'
export function archivePreviewKind(name: string): ArchivePreviewKind {
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(name)) return 'audio'
  if (/\.(mp4|webm|ogv|m4v)$/i.test(name)) return 'video'
  return 'text'
}
export function archiveEntryUrl(path: string, entry: string) {
  return `/api/files/archive-entry?path=${encodeURIComponent(path)}&entry=${encodeURIComponent(entry)}`
}
export function readArchiveEntry(path: string, entry: string) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(archiveEntryUrl(path, entry), { signal })
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined)
        throw new ApiError(
          response.status,
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Could not read the file inside this archive.',
        )
      }
      return response.blob()
    },
    catch: (error) =>
      error instanceof Error ? error : new Error('Could not read the archive entry.'),
  })
}
export async function previewText(blob: Blob): Promise<string | undefined> {
  if (blob.size > 2 * 1024 * 1024) return undefined
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer())
    return text.includes('\0') ? undefined : text
  } catch {
    return undefined
  }
}
