export interface WorkspaceTaskbarPinSource {
  kind: 'local'
  rootPath?: string | null
}

/** Serializable pinned taskbar target. */
export interface WorkspaceTaskbarPin {
  id: string
  path: string
  isDirectory: boolean
  title: string
  customIconName?: string | null
  isVirtual?: boolean
  source: WorkspaceTaskbarPinSource
}

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

function pathHasDotDot(p: string): boolean {
  return p.split(/[/\\]/).some((s) => s === '..')
}

/** Pins for /workspace: local source only, safe paths. */
export function filterAdminWorkspaceTaskbarPins(
  items: WorkspaceTaskbarPin[],
): WorkspaceTaskbarPin[] {
  return items.filter(
    (p) =>
      p.source.kind === 'local' &&
      typeof p.path === 'string' &&
      p.path.length > 0 &&
      !pathHasDotDot(p.path),
  )
}
