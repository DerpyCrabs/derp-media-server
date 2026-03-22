import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { groupIdForWindow } from './tab-group-ops'

export type MergeTarget = { groupId: string; insertIndex: number }

function isUnderWindowGroup(el: Element, groupId: string): boolean {
  const g = el.closest('[data-window-group]')
  return g?.getAttribute('data-window-group') === groupId
}

export function findMergeTarget(
  windows: WorkspaceWindowDefinition[],
  draggedWindowId: string,
  clientX: number,
  clientY: number,
): MergeTarget | null {
  const draggedW = windows.find((w) => w.id === draggedWindowId)
  const draggedGroupId = draggedW ? groupIdForWindow(draggedW) : draggedWindowId

  const elements = document.elementsFromPoint(clientX, clientY)
  for (const el of elements) {
    if (!(el instanceof Element)) continue
    if (isUnderWindowGroup(el, draggedGroupId)) continue
    const slotEl =
      el.closest?.('[data-tab-drop-slot]') ?? (el.hasAttribute?.('data-tab-drop-slot') ? el : null)
    if (slotEl && slotEl instanceof HTMLElement) {
      const slot = slotEl.getAttribute('data-tab-drop-slot')
      if (!slot) continue
      const [gid, indexStr] = slot.split(':')
      const insertIndex = parseInt(indexStr, 10)
      if (!gid || gid === draggedGroupId || Number.isNaN(insertIndex)) continue
      return { groupId: gid, insertIndex }
    }
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
      const groupWindows = windows.filter((w) => groupIdForWindow(w) === gid)
      return { groupId: gid, insertIndex: groupWindows.length }
    }
  }
  return null
}
