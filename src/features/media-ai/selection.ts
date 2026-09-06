import { createSignal } from 'solid-js'
import { MediaType, type FileItem } from '@/lib/files/types'
function restore(key: string, image: boolean): FileItem[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) || '[]')
    if (Array.isArray(saved))
      return saved
        .filter(
          (v): v is FileItem =>
            v &&
            typeof v.path === 'string' &&
            typeof v.name === 'string' &&
            (image ? v.type === 'image' : ['audio', 'video'].includes(v.type)),
        )
        .slice(0, 100)
  } catch {}
  return []
}
const [selection, setSelection] = createSignal(restore('media-ai-selection', false))
const [imageSelection, setImageSelection] = createSignal(restore('media-ai-images', true))
export { selection, imageSelection }
export function clearImageSelection() {
  setImageSelection([])
  try {
    sessionStorage.removeItem('media-ai-images')
  } catch {}
}
export function setMediaSelection(files: FileItem[]) {
  const image = files.length > 0 && files.every((file) => file.type === MediaType.IMAGE)
  if (image) setImageSelection(files)
  else setSelection(files)
  try {
    sessionStorage.setItem(
      image ? 'media-ai-images' : 'media-ai-selection',
      JSON.stringify(files.slice(0, 100)),
    )
  } catch {}
}
