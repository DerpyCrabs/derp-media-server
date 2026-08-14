import type { WorkspaceWindowDefinition } from './use-workspace'

export function groupIdForWindow(window: WorkspaceWindowDefinition): string {
  return window.tabGroupId ?? window.id
}

export function orderedVisibleGroupIds(windows: WorkspaceWindowDefinition[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const window of windows) {
    if (window.layout?.minimized) continue
    const groupId = groupIdForWindow(window)
    if (seen.has(groupId)) continue
    seen.add(groupId)
    order.push(groupId)
  }
  return order
}

export function orderedAllGroupIds(windows: WorkspaceWindowDefinition[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const window of windows) {
    const groupId = groupIdForWindow(window)
    if (seen.has(groupId)) continue
    seen.add(groupId)
    order.push(groupId)
  }
  return order
}

export function tabsInGroup(
  windows: WorkspaceWindowDefinition[],
  groupId: string,
): WorkspaceWindowDefinition[] {
  return windows.filter((window) => groupIdForWindow(window) === groupId)
}
