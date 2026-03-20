/**
 * Solid equivalent of `getIcon` from `lib/use-file-icon.tsx` (same defaults; no custom icons / player state yet).
 */
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import Book from 'lucide-solid/icons/book'
import Eye from 'lucide-solid/icons/eye'
import FileQuestion from 'lucide-solid/icons/file-question-mark'
import FileText from 'lucide-solid/icons/file-text'
import Folder from 'lucide-solid/icons/folder'
import ImageIcon from 'lucide-solid/icons/image'
import Link from 'lucide-solid/icons/link'
import Music from 'lucide-solid/icons/music'
import Star from 'lucide-solid/icons/star'
import Video from 'lucide-solid/icons/video'
import type { JSX } from 'solid-js'

const sz = 20
const sw = 2
const ic = 'h-5 w-5'

export function fileIcon(file: FileItem): JSX.Element {
  const type = file.type
  const filePath = file.path
  const isVirtual = file.isVirtual ?? false

  if (isVirtual && filePath === VIRTUAL_FOLDERS.MOST_PLAYED) {
    return <Eye class={`${ic} text-blue-500`} size={sz} stroke-width={sw} />
  }
  if (isVirtual && filePath === VIRTUAL_FOLDERS.FAVORITES) {
    return <Star class={`${ic} text-blue-500`} size={sz} stroke-width={sw} />
  }
  if (isVirtual && filePath === VIRTUAL_FOLDERS.SHARES) {
    return <Link class={`${ic} text-blue-500`} size={sz} stroke-width={sw} />
  }

  switch (type) {
    case MediaType.FOLDER:
      return <Folder class={`${ic} text-blue-500`} size={sz} stroke-width={sw} />
    case MediaType.AUDIO:
      return <Music class={`${ic} text-purple-500`} size={sz} stroke-width={sw} />
    case MediaType.VIDEO:
      return <Video class={`${ic} text-red-500`} size={sz} stroke-width={sw} />
    case MediaType.IMAGE:
      return <ImageIcon class={`${ic} text-green-500`} size={sz} stroke-width={sw} />
    case MediaType.TEXT:
      return <FileText class={`${ic} text-cyan-500`} size={sz} stroke-width={sw} />
    case MediaType.PDF:
      return <Book class={`${ic} text-emerald-500`} size={sz} stroke-width={sw} />
    case MediaType.OTHER:
      return <FileQuestion class={`${ic} text-yellow-500`} size={sz} stroke-width={sw} />
    default:
      return <FileQuestion class={`${ic} text-yellow-500`} size={sz} stroke-width={sw} />
  }
}

export function gridHeroIcon(file: FileItem): JSX.Element {
  return <div class='scale-[2.5] [&_svg]:h-6 [&_svg]:w-6'>{fileIcon(file)}</div>
}
