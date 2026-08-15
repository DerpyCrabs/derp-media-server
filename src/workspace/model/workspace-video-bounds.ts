import { createDefaultBounds, getPlayerBoundsForAspectRatio } from './workspace-geometry'
import { getVideoIntrinsics, videoIntrinsicsCacheKey } from '@/lib/media/video-intrinsics'
import type { WindowSource } from '@/lib/models/window-model'

export function viewerBoundsForVideoOpen(
  filePath: string,
  source: WindowSource,
  defaultIndex: number,
): ReturnType<typeof createDefaultBounds> {
  const dims = getVideoIntrinsics(videoIntrinsicsCacheKey(source, filePath))
  if (!dims) return createDefaultBounds(defaultIndex, 'viewer')
  return getPlayerBoundsForAspectRatio(dims.width / dims.height, null)
}
