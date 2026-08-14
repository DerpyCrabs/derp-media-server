import {
  FILESYSTEM_PROVIDER,
  filesystemResourceAddress,
  filesystemResourceKey,
} from '@/lib/domain/resource'
import type { WorkspacePathMutation } from '@/lib/workspace-path-mutation'
import type { PlaybackItem, PlaybackSession } from './types'

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
  if (item.resource.provider !== FILESYSTEM_PROVIDER) return item
  if (!pathIsWithin(item.locator, oldPath)) return item
  const locator = movePath(item.locator, oldPath, newPath)
  const address = filesystemResourceAddress(item.resource)
  if (!address) return { ...item, locator }
  const logicalPath = pathIsWithin(address.path, oldPath)
    ? movePath(address.path, oldPath, newPath)
    : locator
  return {
    ...item,
    resource: filesystemResourceKey(address.rootId, logicalPath),
    locator,
    name:
      normalizePath(item.locator) === normalizePath(oldPath)
        ? locator.split('/').at(-1) || item.name
        : item.name,
  }
}

export function applyPlaybackPathMutation(
  session: PlaybackSession,
  mutation: WorkspacePathMutation,
): void {
  const snapshot = session.getSnapshot()
  const current = snapshot.currentItem
  if (!current) return

  if (mutation.type === 'path-removed') {
    const queue = snapshot.queue.filter(
      (item) =>
        item.resource.provider !== FILESYSTEM_PROVIDER ||
        !pathIsWithin(item.locator, mutation.path),
    )
    if (queue.length === snapshot.queue.length) return
    if (
      current.resource.provider === FILESYSTEM_PROVIDER &&
      pathIsWithin(current.locator, mutation.path)
    ) {
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
