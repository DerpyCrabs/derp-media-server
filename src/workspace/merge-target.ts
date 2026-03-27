import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { groupIdForWindow } from './tab-group-ops'
import { insertIndexFromTabBodyPointer } from './tab-drop-hit'

export type MergeTarget = { groupId: string; insertIndex: number }

/** Full-group order index of tabs; used by merge / drop logic. */
export function workspaceWindowsByGroupId(
  windows: WorkspaceWindowDefinition[],
): Map<string, WorkspaceWindowDefinition[]> {
  const m = new Map<string, WorkspaceWindowDefinition[]>()
  for (const w of windows) {
    const gid = groupIdForWindow(w)
    let arr = m.get(gid)
    if (!arr) {
      arr = []
      m.set(gid, arr)
    }
    arr.push(w)
  }
  return m
}

function isUnderWindowGroup(el: Element, groupId: string): boolean {
  const g = el.closest('[data-window-group]')
  return g?.getAttribute('data-window-group') === groupId
}

export function mergeTargetFromElement(
  el: Element,
  byGroup: Map<string, WorkspaceWindowDefinition[]>,
  draggedGroupId: string,
  clientX: number,
): MergeTarget | null {
  if (isUnderWindowGroup(el, draggedGroupId)) return null

  const slotEl =
    el.closest?.('[data-tab-drop-slot]') ?? (el.hasAttribute?.('data-tab-drop-slot') ? el : null)
  if (slotEl && typeof slotEl.getAttribute === 'function') {
    const slot = slotEl.getAttribute('data-tab-drop-slot')
    if (!slot) return null
    const [gid, indexStr] = slot.split(':')
    const insertIndex = parseInt(indexStr, 10)
    if (!gid || gid === draggedGroupId || Number.isNaN(insertIndex)) return null
    return { groupId: gid, insertIndex }
  }

  const tabCell = el.closest('[data-workspace-tab-id]')
  if (tabCell && typeof tabCell.getBoundingClientRect === 'function') {
    const groupEl = tabCell.closest('[data-window-group]')
    const gid = groupEl?.getAttribute('data-window-group')
    const tabId = tabCell.getAttribute('data-workspace-tab-id')
    if (!gid || !tabId || gid === draggedGroupId) return null
    const groupWindows = byGroup.get(gid) ?? []
    const idx = groupWindows.findIndex((w) => w.id === tabId)
    if (idx < 0) return null
    const rect = tabCell.getBoundingClientRect()
    const insertIndex = insertIndexFromTabBodyPointer(clientX, rect.left, rect.width, idx)
    return { groupId: gid, insertIndex }
  }

  return null
}

export function findMergeTarget(
  windows: WorkspaceWindowDefinition[],
  draggedWindowId: string,
  clientX: number,
  clientY: number,
): MergeTarget | null {
  const draggedW = windows.find((w) => w.id === draggedWindowId)
  const draggedGroupId = draggedW ? groupIdForWindow(draggedW) : draggedWindowId
  const byGroup = workspaceWindowsByGroupId(windows)

  const elements = document.elementsFromPoint(clientX, clientY)
  for (const el of elements) {
    if (!(el instanceof Element)) continue
    const hit = mergeTargetFromElement(el, byGroup, draggedGroupId, clientX)
    if (hit) return hit
  }
  for (const el of elements) {
    if (!(el instanceof Element)) continue
    if (isUnderWindowGroup(el, draggedGroupId)) continue
    const groupEl = el.closest('[data-window-group]')
    if (!groupEl) continue
    const gid = groupEl.getAttribute('data-window-group')
    if (!gid || gid === draggedGroupId) continue

    const rect = groupEl.getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.top + 32) {
      const groupWindows = byGroup.get(gid) ?? []
      return { groupId: gid, insertIndex: groupWindows.length }
    }
  }
  return null
}
