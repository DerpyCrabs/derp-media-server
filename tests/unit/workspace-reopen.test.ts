import { expect, test } from 'bun:test'
import { MediaType } from '@/lib/files/types'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import { captureClosedWindows, reopenWorkspaceWindows } from '@/workspace/model/workspace-reopen'
import { tabsInGroup, groupIdForWindow } from '@/workspace/tabs/tab-group-ops'
function browserTab(
  id: string,
  opts?: { tabGroupId?: string | null; tabPinned?: boolean },
): WorkspaceWindowDefinition {
  const gid = opts?.tabGroupId ?? 'g1'
  return {
    id,
    type: 'browser',
    title: id,
    iconName: null,
    iconPath: '',
    iconType: MediaType.FOLDER,
    iconIsVirtual: false,
    source: { kind: 'local', rootPath: null },
    initialState: { dir: '/' },
    tabGroupId: gid,
    layout: { minimized: false, zIndex: 1 },
    ...(opts?.tabPinned ? { tabPinned: true } : {}),
  }
}

function baseState(windows: WorkspaceWindowDefinition[]): PersistedWorkspaceState {
  return {
    workspaceType: 'desktop',
    windows,
    activeWindowId: windows[0]?.id ?? '',
    activeTabMap: { g1: windows[0]?.id ?? '' },
    nextWindowId: 10,
  }
}

test('reopens a middle tab at its original position with a fresh identity', () => {
  const before = baseState([browserTab('a'), browserTab('b'), browserTab('c')])
  const closed = WorkspaceDocumentCommands.closeTab(before, 'b')
  const result = reopenWorkspaceWindows(closed.state, captureClosedWindows(before, closed.removed)!)
  expect(result.state.windows.map((w) => w.title)).toEqual(['a', 'b', 'c'])
  expect(result.openedIds).toEqual(['workspace-window-10'])
  expect(result.state.activeWindowId).toBe('workspace-window-10')
})
test('restores a closed group, pinned order, geometry and split pane', () => {
  const before = baseState([browserTab('a', { tabPinned: true }), browserTab('b')])
  before.activeWindowId = 'b'
  before.tabGroupSplits = { g1: { leftTabId: 'a', leftPaneFraction: 0.4 } }
  const closed = WorkspaceDocumentCommands.closeGroups(before, new Set(['g1']))
  const result = reopenWorkspaceWindows(closed.state, captureClosedWindows(before, closed.removed)!)
  const group = groupIdForWindow(result.state.windows[0]!)
  expect(tabsInGroup(result.state.windows, group).map((w) => w.title)).toEqual(['a', 'b'])
  expect(result.state.windows[0]?.tabPinned).toBe(true)
  expect(result.state.tabGroupSplits?.[group]?.leftTabId).toBe(result.openedIds[0]!)
  expect(result.state.activeWindowId).toBe(result.openedIds[1]!)
})
test('restoring after all siblings close does not leave dangling group references', () => {
  const before = baseState([browserTab('a'), browserTab('b')])
  const closed = WorkspaceDocumentCommands.closeTab(before, 'a')
  const empty = WorkspaceDocumentCommands.closeTab(closed.state, 'b').state
  const result = reopenWorkspaceWindows(empty, captureClosedWindows(before, closed.removed)!)
  expect(result.state.windows).toHaveLength(1)
  expect(result.state.windows[0]?.tabGroupId).toBeNull()
})
test('unsaved Hermes sessions are not resurrected', () => {
  const window = { ...browserTab('a'), type: 'hermes' as const, hermes: { draftId: 'discarded' } }
  expect(captureClosedWindows(baseState([window]), [window])).toBeNull()
})
