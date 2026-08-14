import {
  FILESYSTEM_PROVIDER,
  filesystemResourceAddress,
  filesystemResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type { WorkspacePathMutation } from '@/lib/workspace-path-mutation'
import {
  createBrowserPlaybackPersistence,
  createPlaybackSession,
  type BrowserPlaybackPersistenceOptions,
  type PlaybackItem,
  type PlaybackMedia,
  type PlaybackSession,
  type PlaybackSourceRequest,
  type PlaybackSourceResolution,
  type PlaybackSourceResolver,
} from '@/src/features/playback'
import { buildAudioExtractUrl, buildMediaUrl } from '@/lib/api-media-urls'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemPathForResourceKey,
  filesystemResourceMediaType,
} from './resource'
import { MediaType } from '@/lib/types'

export type FilesystemPlaybackItemInput = Readonly<{
  path: string
  name: string
  media: PlaybackMedia
  rootId?: string
}>

export function createFilesystemPlaybackItem(input: FilesystemPlaybackItemInput): PlaybackItem {
  return {
    resource: filesystemResourceKey(input.rootId ?? DEFAULT_FILESYSTEM_ROOT_ID, input.path),
    name: input.name,
    media: input.media,
  }
}

export function filesystemPlaybackItemPath(item: Pick<PlaybackItem, 'resource'>): string | null {
  return filesystemPathForResourceKey(item.resource)
}

export function filesystemPlaybackItemFromResource(resource: ResourceSummary): PlaybackItem | null {
  if (filesystemPathForResourceKey(resource.key) === null) return null
  const type = filesystemResourceMediaType(resource)
  const media = type === MediaType.AUDIO ? 'audio' : type === MediaType.VIDEO ? 'video' : null
  return media ? { resource: resource.key, name: resource.name, media } : null
}

export function filesystemAudioPlaybackQueue(
  resources: readonly ResourceSummary[],
  current?: PlaybackItem | null,
): PlaybackItem[] {
  let includedCurrent = false
  const queue = resources.flatMap((resource) => {
    if (
      current &&
      resource.key.provider === current.resource.provider &&
      resource.key.id === current.resource.id
    ) {
      includedCurrent = true
      return [current]
    }
    if (filesystemResourceMediaType(resource) !== MediaType.AUDIO) return []
    const item = filesystemPlaybackItemFromResource(resource)
    return item ? [item] : []
  })
  if (current && !includedCurrent) queue.push(current)
  return queue
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function pathIsWithin(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return (
    normalizedPath === normalizedParent ||
    (normalizedParent.length > 0 && normalizedPath.startsWith(`${normalizedParent}/`))
  )
}

function movePath(path: string, oldPath: string, newPath: string): string {
  const normalizedPath = normalizePath(path)
  const normalizedOldPath = normalizePath(oldPath)
  return `${normalizePath(newPath)}${normalizedPath.slice(normalizedOldPath.length)}`
}

function moveItem(item: PlaybackItem, oldPath: string, newPath: string): PlaybackItem {
  const address = filesystemResourceAddress(item.resource)
  if (!address || !pathIsWithin(address.path, oldPath)) return item
  const logicalPath = movePath(address.path, oldPath, newPath)
  return {
    ...item,
    resource: filesystemResourceKey(address.rootId, logicalPath),
    name:
      normalizePath(address.path) === normalizePath(oldPath)
        ? logicalPath.split('/').at(-1) || item.name
        : item.name,
  }
}

export function applyFilesystemPlaybackPathMutation(
  session: PlaybackSession,
  mutation: WorkspacePathMutation,
): void {
  const snapshot = session.getSnapshot()
  const current = snapshot.currentItem
  if (!current) return

  if (mutation.type === 'path-removed') {
    const queue = snapshot.queue.filter((item) => {
      const address = filesystemResourceAddress(item.resource)
      return !address || !pathIsWithin(address.path, mutation.path)
    })
    if (queue.length === snapshot.queue.length) return
    const currentAddress = filesystemResourceAddress(current.resource)
    if (currentAddress && pathIsWithin(currentAddress.path, mutation.path)) {
      if (queue.length === 0) session.dispatch({ type: 'stop' })
      else session.dispatch({ type: 'setQueue', queue })
      return
    }
    session.dispatch({ type: 'setQueue', queue, current })
    return
  }

  const queue = snapshot.queue.map((item) => moveItem(item, mutation.oldPath, mutation.newPath))
  const movedCurrent = moveItem(current, mutation.oldPath, mutation.newPath)
  if (movedCurrent === current) {
    if (queue.some((item, index) => item !== snapshot.queue[index])) {
      session.dispatch({ type: 'setQueue', queue, current })
    }
    return
  }
  session.dispatch({
    type: 'load',
    item: movedCurrent,
    queue,
    autoplay: snapshot.desiredPlaying,
    position: snapshot.position,
    mode: snapshot.mode,
  })
}

export const filesystemPlaybackSourceResolver: PlaybackSourceResolver = Object.freeze({
  resolve(request: PlaybackSourceRequest): PlaybackSourceResolution {
    if (request.item.resource.provider !== FILESYSTEM_PROVIDER) {
      return { kind: 'error', message: 'This provider does not expose a playback source.' }
    }
    const path = filesystemPlaybackItemPath(request.item)
    if (path === null) {
      return { kind: 'error', message: 'This filesystem resource cannot be played.' }
    }
    const url =
      request.item.media === 'video' && request.mode === 'audio'
        ? buildAudioExtractUrl(path)
        : buildMediaUrl(path)
    return { kind: 'resolved', url }
  },
})

export function createFilesystemBrowserPlaybackSession(
  persistenceOptions: BrowserPlaybackPersistenceOptions = {},
): PlaybackSession {
  return createPlaybackSession({
    sourceResolver: filesystemPlaybackSourceResolver,
    persistence: createBrowserPlaybackPersistence(persistenceOptions),
  })
}
