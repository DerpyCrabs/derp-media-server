import {
  isPersistedResourceTarget,
  isResourceSummary,
  type PersistedResourceTarget,
  type ResourceSummary,
} from './resource'

const MIME = 'application/x-derp-file-drag'
const DIRECTORY_MIME = 'application/x-derp-file-drag-directory'

export interface FileDragData {
  path: string
  isDirectory: boolean
  sourceKind: 'local' | 'share'
  sourceToken?: string
  virtualOpenTarget?: import('./virtual-directory').VirtualOpenTarget
  resource?: ResourceSummary
  resourceTarget?: PersistedResourceTarget
}

export function setFileDragData(dt: DataTransfer, data: FileDragData): void {
  dt.setData(MIME, JSON.stringify(data))
  if (data.isDirectory) dt.setData(DIRECTORY_MIME, '1')
  dt.setData('text/plain', data.path)
}

export function getFileDragData(dt: DataTransfer): FileDragData | null {
  try {
    const raw = dt.getData(MIME)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FileDragData
    if (typeof parsed.path !== 'string' || typeof parsed.isDirectory !== 'boolean') return null
    if (parsed.resource && !isResourceSummary(parsed.resource)) return null
    if (parsed.resourceTarget && !isPersistedResourceTarget(parsed.resourceTarget)) return null
    if (
      parsed.virtualOpenTarget &&
      parsed.virtualOpenTarget.type !== 'hermesSession' &&
      parsed.virtualOpenTarget.type !== 'hermesDraft'
    )
      return null
    return parsed
  } catch {
    return null
  }
}

export function hasFileDragData(dt: DataTransfer): boolean {
  return dt.types.includes(MIME)
}

export function isDirectoryFileDragData(dt: DataTransfer): boolean {
  const data = getFileDragData(dt)
  return data?.isDirectory ?? dt.types.includes(DIRECTORY_MIME)
}

export function isCompatibleSource(
  target: { sourceKind: string; sourceToken?: string },
  dragged: FileDragData,
): boolean {
  if (target.sourceKind !== dragged.sourceKind) return false
  if (dragged.sourceKind === 'share' && target.sourceToken !== dragged.sourceToken) return false
  return true
}
