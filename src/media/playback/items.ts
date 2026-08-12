import type { ResourceRef, ResourceSummary } from '@/lib/resource'
import { MediaType, type FileItem } from '@/lib/types'
import type { PlaybackItem } from '@/lib/playback-session'
import { resourceForFileItem } from '@/src/lib/legacy-resource-adapter'
import type { OpenPlan } from '@/src/lib/open-resource'

export type PlaybackMedia = PlaybackItem['media']

function sameResourceRef(left: ResourceRef, right: ResourceRef): boolean {
  return left.libraryId === right.libraryId && left.resourceId === right.resourceId
}

function mediaForResource(resource: ResourceSummary): PlaybackMedia | null {
  if (resource.presentation === 'audio') return 'audio'
  if (resource.presentation === 'video') return 'video'
  return null
}

function itemForResource(
  resource: ResourceSummary,
  media: PlaybackMedia,
  locator: string | undefined,
  version: string | undefined,
): PlaybackItem | null {
  if (!locator || resource.availability !== 'present') return null
  return {
    ref: { ...resource.ref },
    ...(version === undefined ? {} : { version }),
    locator,
    name: resource.name,
    media,
  }
}

/** Converts catalog data to the credential-free identity stored by playback. */
export function playbackItemFromResource(resource: ResourceSummary): PlaybackItem | null {
  const media = mediaForResource(resource)
  if (!media) return null
  return itemForResource(resource, media, resource.legacyLocator, resource.version)
}

/**
 * Converts legacy file rows without retaining shareToken or any other access context.
 * Embedded ResourceSummary identity is preferred; path-only rows keep the existing
 * deterministic legacy reference until catalog resolution can backfill it.
 */
export function playbackItemFromFileItem(file: FileItem, plan?: OpenPlan): PlaybackItem | null {
  if (file.isDirectory) return null
  const resource = resourceForFileItem(file)
  if (plan) return playbackItemFromOpenPlan(plan, resource, file.path)
  const media = file.resource
    ? mediaForResource(resource)
    : file.type === MediaType.AUDIO
      ? 'audio'
      : file.type === MediaType.VIDEO
        ? 'video'
        : null
  if (!media) return null
  return itemForResource(resource, media, resource.legacyLocator ?? file.path, resource.version)
}

/** Uses the semantic media decision from OpenPlan while retaining safe catalog metadata. */
export function playbackItemFromOpenPlan(
  plan: OpenPlan,
  resource: ResourceSummary,
  locatorFallback?: string,
): PlaybackItem | null {
  if (plan.kind !== 'playback' || !sameResourceRef(plan.resource, resource.ref)) return null
  return itemForResource(
    resource,
    plan.media,
    resource.legacyLocator ?? locatorFallback,
    plan.version ?? resource.version,
  )
}

export function playbackItemKey(item: Pick<PlaybackItem, 'ref'>): string {
  return `${item.ref.libraryId.length}:${item.ref.libraryId}${item.ref.resourceId.length}:${item.ref.resourceId}`
}

/** Preserves queue order and keeps the first occurrence of each stable resource identity. */
export function dedupePlaybackQueue(items: readonly PlaybackItem[]): PlaybackItem[] {
  const seen = new Set<string>()
  const queue: PlaybackItem[] = []
  for (const item of items) {
    const key = playbackItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    queue.push(item)
  }
  return queue
}

export function playbackQueueFromFiles(
  files: readonly FileItem[],
  plans?: ReadonlyMap<string, OpenPlan>,
): PlaybackItem[] {
  const items: PlaybackItem[] = []
  for (const file of files) {
    const item = playbackItemFromFileItem(file, plans?.get(file.path))
    if (item) items.push(item)
  }
  return dedupePlaybackQueue(items)
}
