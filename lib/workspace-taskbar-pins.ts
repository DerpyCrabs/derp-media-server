export interface WorkspaceTaskbarPinSource {
  kind: 'local' | 'share'
  rootPath?: string | null
  token?: string
  sharePath?: string | null
}

/** Serializable pinned taskbar target (admin settings or share record). */
export interface WorkspaceTaskbarPin {
  id: string
  path: string
  isDirectory: boolean
  title: string
  customIconName?: string | null
  isVirtual?: boolean
  source: WorkspaceTaskbarPinSource
  resourceTarget?: PersistedResourceTarget
}

function isValidSource(s: unknown): s is WorkspaceTaskbarPinSource {
  if (!s || typeof s !== 'object' || !('kind' in s)) return false
  const k = (s as WorkspaceTaskbarPinSource).kind
  if (k === 'local') return true
  if (k === 'share') return typeof (s as WorkspaceTaskbarPinSource).token === 'string'
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
    isValidSource((p as WorkspaceTaskbarPin).source) &&
    ((p as WorkspaceTaskbarPin).resourceTarget === undefined ||
      isPersistedResourceTarget((p as WorkspaceTaskbarPin).resourceTarget))
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
      !pathHasDotDot(p.path) &&
      (!p.resourceTarget || !pathHasDotDot(p.resourceTarget.legacyLocator)),
  )
}

/** Pins for /share/:token/workspace: share source, path under share root. */
export function filterShareWorkspaceTaskbarPins(
  sharePath: string,
  token: string,
  items: WorkspaceTaskbarPin[],
): WorkspaceTaskbarPin[] {
  const root = sharePath.replace(/\\/g, '/')
  return items.filter((p) => {
    if (p.isVirtual || p.source.kind !== 'share' || p.source.token !== token) return false
    const pathNorm = p.path.replace(/\\/g, '/')
    const targetPath = p.resourceTarget?.legacyLocator.replace(/\\/g, '/')
    if (pathHasDotDot(pathNorm)) return false
    if (targetPath && pathHasDotDot(targetPath)) return false
    return (
      (pathNorm === root || pathNorm.startsWith(`${root}/`)) &&
      (!targetPath || targetPath === root || targetPath.startsWith(`${root}/`))
    )
  })
}
import { isPersistedResourceTarget, type PersistedResourceTarget } from './resource'
