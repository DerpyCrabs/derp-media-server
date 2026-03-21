import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import type { NavigationState } from '@/lib/navigation-session'
import type {
  SnapZone,
  WorkspaceSource,
  WorkspaceWindowDefinition,
  WorkspaceWindowLayout,
} from '@/lib/use-workspace'

export function getSourceLabel(source: WorkspaceSource): string {
  return source.kind === 'share' ? 'Share' : 'Browser'
}

export const SNAP_SIBLING_MAP: Record<SnapZone, Record<string, SnapZone[]>> = {
  left: { right: ['right', 'top-right', 'bottom-right'] },
  right: { left: ['left', 'top-left', 'bottom-left'] },
  'top-left': { right: ['top-right'], bottom: ['bottom-left'] },
  'top-right': { left: ['top-left'], bottom: ['bottom-right'] },
  'bottom-left': { right: ['bottom-right'], top: ['top-left', 'top-half'] },
  'bottom-right': { left: ['bottom-left'], top: ['top-right', 'top-half'] },
  'left-third': { right: ['center-third', 'right-two-thirds'] },
  'center-third': { left: ['left-third'], right: ['right-third'] },
  'right-third': { left: ['center-third', 'left-two-thirds'] },
  'left-two-thirds': { right: ['right-third'] },
  'right-two-thirds': { left: ['left-third'] },
  'top-left-third': { right: ['top-center-third'], bottom: ['bottom-left-third'] },
  'top-center-third': {
    left: ['top-left-third'],
    right: ['top-right-third'],
    bottom: ['bottom-center-third'],
  },
  'top-right-third': { left: ['top-center-third'], bottom: ['bottom-right-third'] },
  'bottom-left-third': { right: ['bottom-center-third'], top: ['top-left-third'] },
  'bottom-center-third': {
    left: ['bottom-left-third'],
    right: ['bottom-right-third'],
    top: ['top-center-third'],
  },
  'bottom-right-third': { left: ['bottom-center-third'], top: ['top-right-third'] },
  'top-half': { bottom: ['bottom-half', 'bottom-left', 'bottom-right'] },
  'bottom-half': { top: ['top-half'] },
  'top-third': { bottom: ['middle-third'] },
  'middle-third': { top: ['top-third'], bottom: ['bottom-third'] },
  'bottom-third': { top: ['middle-third'] },
}

const TASKBAR_HEIGHT = 32
/** Height of the player window title bar (drag handle + border). Must match workspace window header. */
const PLAYER_WINDOW_HEADER_HEIGHT = 33

export function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 720 }
  }

  return {
    width: window.innerWidth,
    height: Math.max(window.innerHeight - TASKBAR_HEIGHT, 480),
  }
}

export type WorkspaceBounds = NonNullable<WorkspaceWindowLayout['bounds']>

export function getPlayerBoundsForAspectRatio(
  aspectRatio: number,
  currentBounds: WorkspaceBounds | null,
): WorkspaceBounds {
  const viewport = getViewportSize()
  const maxWidth = Math.max(viewport.width - 48, 420)
  const maxWindowHeight = Math.max(viewport.height - 48, 320)
  const maxContentHeight = maxWindowHeight - PLAYER_WINDOW_HEADER_HEIGHT
  const minWidth = 360
  const minWindowHeight = 240

  let contentWidth: number
  let contentHeight: number
  if (maxContentHeight * aspectRatio <= maxWidth) {
    contentHeight = maxContentHeight
    contentWidth = Math.round(contentHeight * aspectRatio)
  } else {
    contentWidth = maxWidth
    contentHeight = Math.round(contentWidth / aspectRatio)
  }
  let width = Math.max(minWidth, Math.min(maxWidth, contentWidth))
  let height = Math.round(width / aspectRatio) + PLAYER_WINDOW_HEADER_HEIGHT
  if (height > maxWindowHeight) {
    height = maxWindowHeight
    width = Math.round((height - PLAYER_WINDOW_HEADER_HEIGHT) * aspectRatio)
    width = Math.max(minWidth, Math.min(maxWidth, width))
  } else if (height < minWindowHeight) {
    height = minWindowHeight
    width = Math.round((height - PLAYER_WINDOW_HEADER_HEIGHT) * aspectRatio)
    width = Math.max(minWidth, Math.min(maxWidth, width))
  }

  let x: number
  let y: number
  if (currentBounds) {
    x = Math.round(currentBounds.x + (currentBounds.width - width) / 2)
    y = Math.round(currentBounds.y + (currentBounds.height - height) / 2)
  } else {
    x = Math.round((viewport.width - width) / 2)
    y = Math.round((viewport.height - height) / 2)
  }
  x = Math.max(16, Math.min(viewport.width - width - 16, x))
  y = Math.max(16, Math.min(viewport.height - height - 16, y))

  return { x, y, width, height }
}

export function createDefaultBounds(
  index: number,
  type: WorkspaceWindowDefinition['type'],
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()
  const maxWidth = Math.max(viewport.width - 48, 420)
  const maxHeight = Math.max(viewport.height - 48, 320)
  const isVertical = viewport.height > viewport.width

  if (type === 'player') {
    return getPlayerBoundsForAspectRatio(16 / 9, null)
  }

  let width: number
  let height: number
  if (isVertical) {
    width = Math.min(Math.max(Math.round(viewport.width * 0.9), 360), maxWidth)
    height = Math.min(Math.max(Math.round(viewport.height * 0.55), 360), maxHeight)
  } else {
    width = Math.min(Math.max(Math.round(viewport.width * 0.34), 420), maxWidth)
    height = Math.min(Math.max(Math.round(viewport.height * 0.58), 360), maxHeight)
  }

  const offset = index * 28
  return {
    x: Math.min(24 + offset, Math.max(viewport.width - width - 16, 16)),
    y: Math.min(24 + offset, Math.max(viewport.height - height - 16, 16)),
    width,
    height,
  }
}

export function createFullscreenBounds(): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()

  return {
    x: 0,
    y: 0,
    width: Math.max(viewport.width, 360),
    height: Math.max(viewport.height, 240),
  }
}

export function createWindowLayout(
  layout: WorkspaceWindowLayout | undefined,
  fallbackBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
  zIndex: number,
): WorkspaceWindowLayout {
  return {
    bounds: layout?.bounds ?? fallbackBounds,
    fullscreen: layout?.fullscreen ?? false,
    snapZone: layout?.snapZone ?? null,
    minimized: layout?.minimized ?? false,
    zIndex: layout?.zIndex ?? zIndex,
    restoreBounds: layout?.restoreBounds ?? null,
  }
}

const LEFT_SIDE_ZONES: SnapZone[] = [
  'left',
  'top-left',
  'bottom-left',
  'left-third',
  'left-two-thirds',
  'top-left-third',
  'bottom-left-third',
]
const RIGHT_SIDE_ZONES: SnapZone[] = [
  'right',
  'top-right',
  'bottom-right',
  'right-third',
  'right-two-thirds',
  'top-right-third',
  'bottom-right-third',
]
const TOP_SIDE_ZONES: SnapZone[] = [
  'top-left',
  'top-right',
  'top-half',
  'top-third',
  'middle-third',
  'top-left-third',
  'top-center-third',
  'top-right-third',
]
const BOTTOM_SIDE_ZONES: SnapZone[] = [
  'bottom-left',
  'bottom-right',
  'bottom-half',
  'middle-third',
  'bottom-third',
  'bottom-left-third',
  'bottom-center-third',
  'bottom-right-third',
]

export function snapZoneToBounds(zone: SnapZone): NonNullable<WorkspaceWindowLayout['bounds']> {
  return snapZoneToBoundsWithOccupied(zone, [])
}

export function snapZoneToBoundsWithOccupied(
  zone: SnapZone,
  occupied: ReadonlyArray<{
    bounds: NonNullable<WorkspaceWindowLayout['bounds']>
    snapZone: SnapZone
  }>,
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()
  const halfW = Math.round(viewport.width / 2)
  const halfH = Math.round(viewport.height / 2)
  const thirdW = Math.round(viewport.width / 3)
  const twoThirdW = Math.round((viewport.width * 2) / 3)
  const thirdH = Math.round(viewport.height / 3)
  const twoThirdH = Math.round((viewport.height * 2) / 3)

  const defaultBounds: NonNullable<WorkspaceWindowLayout['bounds']> = (() => {
    switch (zone) {
      case 'left':
        return { x: 0, y: 0, width: halfW, height: viewport.height }
      case 'right':
        return { x: halfW, y: 0, width: viewport.width - halfW, height: viewport.height }
      case 'top-left':
        return { x: 0, y: 0, width: halfW, height: halfH }
      case 'top-right':
        return { x: halfW, y: 0, width: viewport.width - halfW, height: halfH }
      case 'bottom-left':
        return { x: 0, y: halfH, width: halfW, height: viewport.height - halfH }
      case 'bottom-right':
        return {
          x: halfW,
          y: halfH,
          width: viewport.width - halfW,
          height: viewport.height - halfH,
        }
      case 'top-half':
        return { x: 0, y: 0, width: viewport.width, height: halfH }
      case 'bottom-half':
        return { x: 0, y: halfH, width: viewport.width, height: viewport.height - halfH }
      case 'top-third':
        return { x: 0, y: 0, width: viewport.width, height: thirdH }
      case 'middle-third':
        return { x: 0, y: thirdH, width: viewport.width, height: twoThirdH - thirdH }
      case 'bottom-third':
        return { x: 0, y: twoThirdH, width: viewport.width, height: viewport.height - twoThirdH }
      case 'left-third':
        return { x: 0, y: 0, width: thirdW, height: viewport.height }
      case 'center-third':
        return { x: thirdW, y: 0, width: twoThirdW - thirdW, height: viewport.height }
      case 'right-third':
        return { x: twoThirdW, y: 0, width: viewport.width - twoThirdW, height: viewport.height }
      case 'left-two-thirds':
        return { x: 0, y: 0, width: twoThirdW, height: viewport.height }
      case 'right-two-thirds':
        return { x: thirdW, y: 0, width: viewport.width - thirdW, height: viewport.height }
      case 'top-left-third':
        return { x: 0, y: 0, width: thirdW, height: halfH }
      case 'top-center-third':
        return { x: thirdW, y: 0, width: twoThirdW - thirdW, height: halfH }
      case 'top-right-third':
        return { x: twoThirdW, y: 0, width: viewport.width - twoThirdW, height: halfH }
      case 'bottom-left-third':
        return { x: 0, y: halfH, width: thirdW, height: viewport.height - halfH }
      case 'bottom-center-third':
        return { x: thirdW, y: halfH, width: twoThirdW - thirdW, height: viewport.height - halfH }
      case 'bottom-right-third':
        return {
          x: twoThirdW,
          y: halfH,
          width: viewport.width - twoThirdW,
          height: viewport.height - halfH,
        }
    }
  })()

  if (occupied.length === 0) return defaultBounds

  const isThirdZone = zone.includes('third')
  const leftOccupied = occupied.filter((o) => LEFT_SIDE_ZONES.includes(o.snapZone))
  const rightOccupied = occupied.filter((o) => RIGHT_SIDE_ZONES.includes(o.snapZone))
  const topOccupied = occupied.filter((o) => TOP_SIDE_ZONES.includes(o.snapZone))
  const bottomOccupied = occupied.filter((o) => BOTTOM_SIDE_ZONES.includes(o.snapZone))

  let { x, y, width, height } = defaultBounds

  if (!isThirdZone) {
    if (RIGHT_SIDE_ZONES.includes(zone) && leftOccupied.length > 0) {
      const leftEdge = Math.max(...leftOccupied.map((o) => o.bounds.x + o.bounds.width))
      x = leftEdge
      width = viewport.width - leftEdge
    }
    if (LEFT_SIDE_ZONES.includes(zone) && rightOccupied.length > 0) {
      const rightEdge = Math.min(...rightOccupied.map((o) => o.bounds.x))
      width = rightEdge
    }
  }

  if (BOTTOM_SIDE_ZONES.includes(zone) && topOccupied.length > 0) {
    const topEdge = Math.max(...topOccupied.map((o) => o.bounds.y + o.bounds.height))
    y = topEdge
    height = viewport.height - topEdge
  }
  if (TOP_SIDE_ZONES.includes(zone) && bottomOccupied.length > 0) {
    const bottomEdge = Math.min(...bottomOccupied.map((o) => o.bounds.y))
    height = bottomEdge - y
  }

  return { x, y, width, height }
}

function layoutGroupKey(w: WorkspaceWindowDefinition): string {
  return w.tabGroupId ?? w.id
}

/**
 * Recompute pixel bounds from `snapZone` for every snapped window group.
 * Named layout presets and localStorage often keep stale bounds (different viewport, old clamping);
 * without this, tiles look fine but shared-edge resize can miss neighbors.
 */
export function reconcileLayoutBoundsFromSnapZones(
  windows: WorkspaceWindowDefinition[],
): WorkspaceWindowDefinition[] {
  if (windows.length === 0) return windows

  const repByGroup = new Map<string, WorkspaceWindowDefinition>()
  for (const w of windows) {
    const g = layoutGroupKey(w)
    if (!repByGroup.has(g)) repByGroup.set(g, w)
  }

  const snappedReps = [...repByGroup.values()].filter(
    (w) => w.layout?.snapZone && !w.layout.fullscreen && !w.layout.minimized,
  )
  if (snappedReps.length === 0) return windows

  const sorted = [...snappedReps].sort((a, b) => {
    const za = a.layout!.snapZone!
    const zb = b.layout!.snapZone!
    const aa = snapZoneToBounds(za)
    const bb = snapZoneToBounds(zb)
    if (aa.x !== bb.x) return aa.x - bb.x
    if (aa.y !== bb.y) return aa.y - bb.y
    const areaA = aa.width * aa.height
    const areaB = bb.width * bb.height
    if (areaA !== areaB) return areaB - areaA
    return za.localeCompare(zb)
  })

  const occupied: {
    bounds: NonNullable<WorkspaceWindowLayout['bounds']>
    snapZone: SnapZone
  }[] = []
  const boundsByGroup = new Map<string, NonNullable<WorkspaceWindowLayout['bounds']>>()

  for (const w of sorted) {
    const zone = w.layout!.snapZone!
    const b = snapZoneToBoundsWithOccupied(zone, occupied)
    boundsByGroup.set(layoutGroupKey(w), b)
    occupied.push({ bounds: b, snapZone: zone })
  }

  return windows.map((w) => {
    const lz = w.layout
    if (!lz?.snapZone || lz.fullscreen || lz.minimized) return w
    const b = boundsByGroup.get(layoutGroupKey(w))
    if (!b) return w
    return {
      ...w,
      layout: {
        ...lz,
        bounds: b,
      },
    }
  })
}

export function getPlaybackTitle(path: string | undefined) {
  if (!path) return 'Video Player'

  const normalized = path.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop()
  return fileName || 'Video Player'
}

export const PLAYER_WINDOW_ID = 'workspace-player-window'

export function isVideoPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return getMediaType(extension) === MediaType.VIDEO
}

export function getInitialWindowIcon(
  type: WorkspaceWindowDefinition['type'],
  initialState: Partial<NavigationState>,
): Pick<WorkspaceWindowDefinition, 'iconPath' | 'iconType' | 'iconIsVirtual'> {
  if (type === 'browser') {
    return {
      iconPath: initialState.dir ?? '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
    }
  }

  if (type === 'player') {
    return {
      iconPath: initialState.playing ?? '',
      iconType: MediaType.VIDEO,
      iconIsVirtual: false,
    }
  }

  if (type === 'viewer' && initialState.viewing) {
    return {
      iconPath: initialState.viewing,
      iconType: getMediaType(initialState.viewing.split('.').pop() ?? ''),
      iconIsVirtual: false,
    }
  }

  return {
    iconPath: '',
    iconType: MediaType.OTHER,
    iconIsVirtual: false,
  }
}

export function insertWindowAtGroupIndex(
  current: WorkspaceWindowDefinition[],
  windowToInsert: WorkspaceWindowDefinition,
  groupId: string,
  insertIndex: number,
): WorkspaceWindowDefinition[] {
  const groupIndices: number[] = []
  current.forEach((w, i) => {
    const gid = w.tabGroupId ?? w.id
    if (gid === groupId) groupIndices.push(i)
  })
  const targetGlobalIndex =
    insertIndex >= groupIndices.length
      ? (groupIndices[groupIndices.length - 1] ?? -1) + 1
      : groupIndices[insertIndex]
  return [
    ...current.slice(0, targetGlobalIndex),
    windowToInsert,
    ...current.slice(targetGlobalIndex),
  ]
}
