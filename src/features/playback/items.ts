import {
  adaptFileItemResource,
  LEGACY_FILESYSTEM_ROOT_ID,
  type FileItemResourceOptions,
} from '@/lib/domain/file-item-resource'
import { filesystemResourceKey, type ResourceKey } from '@/lib/domain/resource'
import { MediaType, type FileItem } from '@/lib/types'
import type { PlaybackItem, PlaybackMedia } from './types'

export type FilesystemPlaybackItemInput = Readonly<{
  locator: string
  name: string
  media: PlaybackMedia
  rootId?: string
  logicalPath?: string
}>

export function createFilesystemPlaybackItem(input: FilesystemPlaybackItemInput): PlaybackItem {
  return {
    resource: filesystemResourceKey(
      input.rootId ?? LEGACY_FILESYSTEM_ROOT_ID,
      input.logicalPath ?? input.locator,
    ),
    locator: input.locator,
    name: input.name,
    media: input.media,
  }
}

export function playbackItemFromFileItem(
  file: FileItem,
  options: FileItemResourceOptions = {},
): PlaybackItem | null {
  const media =
    file.type === MediaType.AUDIO ? 'audio' : file.type === MediaType.VIDEO ? 'video' : null
  if (!media) return null
  const adapted = adaptFileItemResource(file, options)
  return {
    resource: adapted.resource.key,
    locator: adapted.legacyPath,
    name: adapted.resource.name,
    media,
  }
}

export function playbackItemWithResource(
  item: Pick<PlaybackItem, 'locator' | 'name' | 'media'>,
  resource: ResourceKey,
): PlaybackItem {
  return { ...item, resource }
}

export function audioPlaybackQueueFromFiles(
  files: readonly FileItem[],
  options: FileItemResourceOptions = {},
  current?: PlaybackItem | null,
): PlaybackItem[] {
  let includedCurrent = false
  const queue = files.flatMap((file) => {
    if (file.isVirtual) return []
    if (current && file.path === current.locator) {
      includedCurrent = true
      return [current]
    }
    if (file.type !== MediaType.AUDIO) return []
    const item = playbackItemFromFileItem(file, options)
    return item ? [item] : []
  })
  if (current && !includedCurrent) queue.push(current)
  return queue
}
