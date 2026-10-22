import { shareValue } from 'effectweb/advanced'
import type { WindowDefinition } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import { canvasViewFromWorkspace } from './canvas-projection'
import type { CanvasWindow } from './infinite-canvas'

export function createCanvasScene(
  document: PersistedWorkspaceState,
  previous?: CanvasScene,
): CanvasScene {
  const nextState = canvasViewFromWorkspace(document)
  const state = previous ? shareValue(previous.state, nextState) : nextState
  const definitions = new Map(document.windows.map((window) => [window.id, window]))
  const groups = new Map<string, CanvasWindow[]>()
  for (const window of state.windows) {
    const groupId = definitions.get(window.id)?.tabGroupId ?? window.id
    const members = groups.get(groupId)
    if (members) members.push(window)
    else groups.set(groupId, [window])
  }
  const activeWindows = new Map<string, CanvasWindow>()
  const tabs = new Map<string, WindowDefinition[]>()
  for (const [groupId, members] of groups) {
    if (previous?.groups.has(groupId))
      groups.set(groupId, shareValue(previous.groups.get(groupId)!, members))
    const activeId = document.activeTabMap[groupId]
    activeWindows.set(groupId, members.find((window) => window.id === activeId) ?? members[0]!)
    tabs.set(
      groupId,
      shareValue(
        previous?.tabs.get(groupId) ?? [],
        members.map((window) => definitions.get(window.id)!),
      ),
    )
  }
  return {
    state,
    definitions,
    groups,
    activeWindows,
    tabs,
    groupIds: shareValue(previous?.groupIds ?? [], [...groups.keys()]),
  }
}

export type CanvasScene = {
  state: ReturnType<typeof canvasViewFromWorkspace>
  definitions: Map<string, WindowDefinition>
  groups: Map<string, CanvasWindow[]>
  activeWindows: Map<string, CanvasWindow>
  tabs: Map<string, WindowDefinition[]>
  groupIds: string[]
}
