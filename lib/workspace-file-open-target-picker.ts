import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { groupIdForWindow, tabsInGroup } from '@/src/workspace/tab-group-ops'

export function pickWorkspaceWindowAtClientPoint(
  windows: WorkspaceWindowDefinition[],
  containerRect: DOMRect,
  clientX: number,
  clientY: number,
): string | null {
  const lx = clientX - containerRect.left
  const ly = clientY - containerRect.top
  const candidates = windows
    .filter((w) => !w.layout?.minimized && w.layout?.bounds)
    .map((w) => ({ w, z: w.layout?.zIndex ?? 0 }))
    .sort((a, b) => b.z - a.z)
  for (const { w } of candidates) {
    const b = w.layout!.bounds!
    if (lx >= b.x && ly >= b.y && lx <= b.x + b.width && ly <= b.y + b.height) {
      return w.id
    }
  }
  return null
}

export function layoutBoundsForWindowHighlight(
  windows: WorkspaceWindowDefinition[],
  windowId: string,
): NonNullable<WorkspaceWindowDefinition['layout']>['bounds'] | null {
  const win = windows.find((w) => w.id === windowId)
  if (!win || win.layout?.minimized || !win.layout?.bounds) return null
  const gid = groupIdForWindow(win)
  const members = tabsInGroup(windows, gid)
  const withBounds = members.find((m) => m.layout?.bounds && !m.layout.minimized)
  return withBounds?.layout?.bounds ?? win.layout.bounds
}
