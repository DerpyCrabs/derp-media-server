import { MediaType, type FileItem } from '@/lib/files/types'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { playbackItemKey } from './playback-session'
import type { PlaybackItem, PlaybackMedia } from './types'

export type FilesystemPlaybackItemInput = Readonly<{
  locator: string
  name: string
  media: PlaybackMedia
}>

export function createFilesystemPlaybackItem(input: FilesystemPlaybackItemInput): PlaybackItem {
  return {
    locator: input.locator,
    name: input.name,
    media: input.media,
  }
}

export function playbackItemFromFileItem(file: FileItem): PlaybackItem | null {
  const media =
    file.type === MediaType.AUDIO ? 'audio' : file.type === MediaType.VIDEO ? 'video' : null
  if (!media || file.isVirtual) return null
  return createFilesystemPlaybackItem({ locator: file.path, name: file.name, media })
}

export function playbackPathKey(path: string): string {
  return path.replace(/\\/g, '/')
}

export function playbackPathMatches(item: PlaybackItem | null | undefined, path: string): boolean {
  return !!item && playbackPathKey(item.locator) === playbackPathKey(path)
}

export function playbackItemFromPath(path: string, media: PlaybackMedia): PlaybackItem
export function playbackItemFromPath(path: string): PlaybackItem | null
export function playbackItemFromPath(path: string, media?: PlaybackMedia): PlaybackItem | null {
  const resolvedMedia =
    media ??
    (() => {
      const type = getMediaTypeFromPath(path)
      return type === MediaType.AUDIO ? 'audio' : type === MediaType.VIDEO ? 'video' : null
    })()
  if (!resolvedMedia) return null
  return createFilesystemPlaybackItem({
    locator: path,
    name: path.split(/[/\\]/).pop() || path,
    media: resolvedMedia,
  })
}

export function playbackQueuesEqual(
  left: readonly PlaybackItem[],
  right: readonly PlaybackItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const candidate = right[index]
      return (
        !!candidate &&
        playbackItemKey(item) === playbackItemKey(candidate) &&
        item.locator === candidate.locator &&
        item.name === candidate.name &&
        item.media === candidate.media
      )
    })
  )
}

export function audioPlaybackQueueFromFiles(
  files: readonly FileItem[],
  current?: PlaybackItem | null,
): PlaybackItem[] {
  let includedCurrent = false
  const queue = files.flatMap((file) => {
    if (file.isVirtual) return []
    if (current && playbackPathMatches(current, file.path)) {
      includedCurrent = true
      return [current]
    }
    if (file.type !== MediaType.AUDIO) return []
    const item = playbackItemFromFileItem(file)
    return item ? [item] : []
  })
  if (current && !includedCurrent) queue.push(current)
  return queue
}
