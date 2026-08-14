import { isResourceKey, type ResourceKey } from '@/lib/domain/resource'

const MIME = 'application/x-derp-resource-drag'
const DIRECTORY_MIME = 'application/x-derp-resource-drag-directory'

export type ResourceDragData = Readonly<{
  key: ResourceKey
  isDirectory: boolean
}>

export function setResourceDragData(dt: DataTransfer, data: ResourceDragData): void {
  dt.setData(MIME, JSON.stringify(data))
  if (data.isDirectory) dt.setData(DIRECTORY_MIME, '1')
}

export function getResourceDragData(dt: DataTransfer): ResourceDragData | null {
  try {
    const raw = dt.getData(MIME)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!isResourceKey(parsed.key) || typeof parsed.isDirectory !== 'boolean') return null
    return { key: parsed.key, isDirectory: parsed.isDirectory }
  } catch {
    return null
  }
}

export function hasResourceDragData(dt: DataTransfer): boolean {
  return dt.types.includes(MIME)
}

export function isDirectoryResourceDragData(dt: DataTransfer): boolean {
  return getResourceDragData(dt)?.isDirectory ?? dt.types.includes(DIRECTORY_MIME)
}
