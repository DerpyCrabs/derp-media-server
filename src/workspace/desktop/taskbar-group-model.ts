import type { Snapshot } from 'effectweb'
import type { WindowDefinition, PersistedWindowState } from '@/lib/models/window-model'
import { resolveGroupVisibleTabId, tabsInGroup } from '../tabs/tab-group-ops'

export type TaskbarGroupModel = {
  window: Snapshot<Omit<WindowDefinition, 'layout'>> | undefined
  count: number
  leaderId: string | undefined
  visibleId: string
  active: boolean
  minimized: boolean
}

function taskbarWindow(window: Snapshot<WindowDefinition>) {
  const { layout: _layout, ...content } = window
  return content
}

export function taskbarGroupModel(
  workspace: Snapshot<PersistedWindowState> | null,
  groupId: string,
): TaskbarGroupModel {
  const windows = tabsInGroup(workspace?.windows ?? [], groupId)
  const leader = windows[0]
  const visibleId = workspace ? resolveGroupVisibleTabId(workspace, groupId) : ''
  const display = windows.find((window) => window.id === visibleId) ?? leader
  return {
    window: display ? taskbarWindow(display) : undefined,
    count: windows.length,
    leaderId: leader?.id,
    visibleId,
    active: windows.some((window) => window.id === workspace?.activeWindowId),
    minimized: leader?.layout?.minimized ?? false,
  }
}
