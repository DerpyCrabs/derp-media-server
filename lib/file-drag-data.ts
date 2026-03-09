const MIME = 'application/x-derp-file-drag'

export interface FileDragData {
  path: string
  isDirectory: boolean
  sourceKind: 'local' | 'share'
  sourceToken?: string
}

export function setFileDragData(dt: DataTransfer, data: FileDragData): void {
  dt.setData(MIME, JSON.stringify(data))
  dt.setData('text/plain', data.path)
}

export function getFileDragData(dt: DataTransfer): FileDragData | null {
  try {
    const raw = dt.getData(MIME)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FileDragData
    if (typeof parsed.path !== 'string' || typeof parsed.isDirectory !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

export function hasFileDragData(dt: DataTransfer): boolean {
  return dt.types.includes(MIME)
}

export function isCompatibleSource(
  target: { sourceKind: string; sourceToken?: string },
  dragged: FileDragData,
): boolean {
  if (target.sourceKind !== dragged.sourceKind) return false
  if (dragged.sourceKind === 'share' && target.sourceToken !== dragged.sourceToken) return false
  return true
}
