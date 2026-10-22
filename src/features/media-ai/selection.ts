import { Schema } from 'effect'
import { fileItemSchema } from '@/lib/files/file-schemas'
import { modelOwner } from 'effectweb'
import { MediaType, type FileItem } from '@/lib/files/types'
function restore(key: string, image: boolean): readonly FileItem[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) || '[]')
    const result = Schema.decodeUnknownExit(Schema.Array(fileItemSchema))(saved)
    if (result._tag === 'Success')
      return result.value
        .filter((item) =>
          image
            ? item.type === MediaType.IMAGE
            : item.type === MediaType.AUDIO || item.type === MediaType.VIDEO,
        )
        .slice(0, 100)
  } catch {}
  return []
}
const owner = modelOwner({
  selection: restore('media-ai-selection', false),
  images: restore('media-ai-images', true),
})
export const mediaSelectionSource = owner.source
export const selection = () => owner.read().selection
export const imageSelection = () => owner.read().images
export function clearImageSelection() {
  owner.patch({ images: [] })
  try {
    sessionStorage.removeItem('media-ai-images')
  } catch {}
}
export function setMediaSelection(files: readonly FileItem[]) {
  const image = files.length > 0 && files.every((file) => file.type === MediaType.IMAGE)
  if (image) owner.patch({ images: files })
  else owner.patch({ selection: files })
  try {
    sessionStorage.setItem(
      image ? 'media-ai-images' : 'media-ai-selection',
      JSON.stringify(files.slice(0, 100)),
    )
  } catch {}
}
