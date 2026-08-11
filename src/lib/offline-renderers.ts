import { MediaType, type FileItem } from '@/lib/types'

export type OfflineRenderer = 'image' | 'markdown' | 'text' | 'unsupported'

export function offlineRenderersForFile(
  file: Pick<FileItem, 'extension' | 'type'>,
): readonly OfflineRenderer[] {
  if (file.type === MediaType.IMAGE) return ['image']
  if (file.type === MediaType.OTHER) return ['unsupported']
  if (file.type !== MediaType.TEXT) return []
  return file.extension.toLowerCase() === 'md' ? ['text', 'markdown'] : ['text']
}

const loaders: Record<OfflineRenderer, () => Promise<unknown>> = {
  image: () => import('../media/ImageViewerDialog'),
  markdown: () => import('../media/MarkdownDocument'),
  text: () => import('../media/TextViewerDialog'),
  unsupported: () => import('../media/UnsupportedFileViewerDialog'),
}

const loaded = new Map<OfflineRenderer, Promise<unknown>>()

/** Cache optional viewer chunks while online so newly saved files still open offline. */
export async function ensureOfflineRenderersForFile(
  file: Pick<FileItem, 'extension' | 'type'>,
): Promise<void> {
  await Promise.all(
    offlineRenderersForFile(file).map((renderer) => {
      const existing = loaded.get(renderer)
      if (existing) return existing
      const pending = loaders[renderer]().catch((error) => {
        loaded.delete(renderer)
        throw error
      })
      loaded.set(renderer, pending)
      return pending
    }),
  )
}
