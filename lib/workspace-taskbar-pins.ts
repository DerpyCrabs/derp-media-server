import type {
  WorkspaceTaskbarPinDto,
  WorkspaceTaskbarPinSourceDto,
} from './generated/api-contracts'

export type WorkspaceTaskbarPinSource = WorkspaceTaskbarPinSourceDto

/** Serializable pinned taskbar target. */
export type WorkspaceTaskbarPin = WorkspaceTaskbarPinDto

function isValidSource(s: unknown): s is WorkspaceTaskbarPinSource {
  if (!s || typeof s !== 'object' || !('kind' in s)) return false
  const k = (s as WorkspaceTaskbarPinSource).kind
  if (k === 'local') return true
  return false
}

function isValidPin(p: unknown): p is WorkspaceTaskbarPin {
  return (
    !!p &&
    typeof p === 'object' &&
    typeof (p as WorkspaceTaskbarPin).id === 'string' &&
    typeof (p as WorkspaceTaskbarPin).path === 'string' &&
    typeof (p as WorkspaceTaskbarPin).isDirectory === 'boolean' &&
    typeof (p as WorkspaceTaskbarPin).title === 'string' &&
    isValidSource((p as WorkspaceTaskbarPin).source)
  )
}

export function parseWorkspaceTaskbarPins(raw: unknown): WorkspaceTaskbarPin[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isValidPin)
}
