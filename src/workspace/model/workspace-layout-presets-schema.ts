import type { PersistedWindowState } from '@/lib/models/window-model'
import { parseTaskbarPins } from '@/lib/models/taskbar-pins'
import { filterAdminTaskbarPins } from './workspace-taskbar-pins'
import type { WorkspaceLayoutPreset, WorkspaceLayoutScope } from './workspace-layout-presets-types'

const MAX_WORKSPACE_LAYOUT_PRESETS = 32
const MAX_LAYOUT_PRESET_NAME_LENGTH = 120

function pathHasDotDot(p: string): boolean {
  return p.split(/[/\\]/).some((s) => s === '..')
}

function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

function isValidSourceAdmin(s: unknown): boolean {
  if (!s || typeof s !== 'object' || !('kind' in s)) return false
  return (s as { kind: string }).kind === 'local'
}

function windowPaths(w: unknown): string[] {
  if (!w || typeof w !== 'object') return []
  const o = w as Record<string, unknown>
  const initial = o.initialState
  const paths: string[] = []
  const iconPath = o.iconPath
  if (typeof iconPath === 'string' && iconPath.length > 0) paths.push(iconPath)
  if (initial && typeof initial === 'object') {
    const dir = (initial as { dir?: unknown }).dir
    const viewing = (initial as { viewing?: unknown }).viewing
    if (typeof dir === 'string' && dir.length > 0) paths.push(dir)
    if (typeof viewing === 'string' && viewing.length > 0) paths.push(viewing)
  }
  return paths
}

function snapshotStructurallyOk(snapshot: unknown): snapshot is PersistedWindowState {
  if (!snapshot || typeof snapshot !== 'object') return false
  const s = snapshot as { windows?: unknown }
  return Array.isArray(s.windows) && s.windows.length > 0
}

function snapshotAllowedForAdminSnapshot(snapshot: unknown): boolean {
  if (!snapshotStructurallyOk(snapshot)) return false
  for (const w of snapshot.windows) {
    if (typeof w !== 'object' || !w) return false
    const src = (w as { source?: unknown }).source
    if (!isValidSourceAdmin(src)) return false
    for (const p of windowPaths(w)) {
      const n = norm(p)
      if (pathHasDotDot(n)) return false
    }
  }
  const pins = parseTaskbarPins((snapshot as PersistedWindowState).pinnedTaskbarItems)
  return filterAdminTaskbarPins(pins).length === pins.length
}

function isLayoutScope(s: unknown): s is WorkspaceLayoutScope {
  return s === 'admin'
}

export function parseWorkspaceLayoutPresetsList(raw: unknown): WorkspaceLayoutPreset[] {
  if (!Array.isArray(raw)) return []
  const out: WorkspaceLayoutPreset[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || o.snapshot === undefined) continue
    if (!isLayoutScope(o.scope)) continue
    if (typeof o.name !== 'string' || o.name.length > MAX_LAYOUT_PRESET_NAME_LENGTH) continue
    const nameTrim = o.name.trim()
    if (!nameTrim) continue
    const createdAt = typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString()
    const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : undefined
    out.push({
      id: o.id,
      name: nameTrim,
      scope: o.scope,
      snapshot: o.snapshot as PersistedWindowState,
      createdAt,
      updatedAt,
    })
  }
  return out
}

export function sanitizeAdminWorkspaceLayoutPresets(
  presets: WorkspaceLayoutPreset[],
): WorkspaceLayoutPreset[] {
  const filtered = presets.filter(
    (p) => p.scope === 'admin' && p.name.length > 0 && snapshotAllowedForAdminSnapshot(p.snapshot),
  )
  return filtered.slice(0, MAX_WORKSPACE_LAYOUT_PRESETS)
}
