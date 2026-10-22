import { expect, test } from 'bun:test'
import type { WindowDefinition } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import { EMPTY_FILE_ICON_CONTEXT } from '@/features/explorer/file-icon'
import {
  desktopWindowGroups,
  type DesktopGroupEnvironment,
} from '@/workspace/desktop/desktop-window-groups'

const noop = () => {}
const environment: DesktopGroupEnvironment = {
  editable: true,
  onSet: noop,
  content: {
    editableFolders: [],
    knowledgeBases: [],
    fileIconContext: EMPTY_FILE_ICON_CONTEXT,
    windowActions: {
      browser: {
        navigate: noop,
        openViewer: noop,
        openReader: noop,
        openVirtual: noop,
        play: noop,
      },
      viewer: { updateViewing: noop },
      hermes: { sessionCreated: noop, titleChanged: noop },
    },
  },
  windows: {
    focus: noop,
    close: noop,
    minimize: noop,
    toggleFullscreen: noop,
    beginPointerGesture: () => ({ commit: noop, cancel: noop }),
  },
  tabs: {
    activate: noop,
    close: noop,
    togglePinned: noop,
    pull: noop,
    dropFile: noop,
    startSplitDrag: noop,
  },
  picker: { open: noop },
  snap: {
    model: {
      workspaceAreaNode: null,
      mergeTargetPreview: null,
      dragSnapWindowId: null,
      actions: {
        bindWorkspaceAreaRoot: noop,
        bindSnapPreview: noop,
        bindSnapAssistRoot: noop,
        engageSnapAssistFromHandle: noop,
        disengageSnapAssistFromPanel: noop,
        restoreDrag: () => undefined,
        updateWindowBounds: noop,
        resizeSnappedWindowBounds: noop,
        setTilingPickerHoverPreview: () => null,
      },
    },
    moveDrag: noop,
    endDrag: noop,
  },
}
function window(id: string, tabGroupId?: string): WindowDefinition {
  return {
    id,
    tabGroupId,
    type: 'browser',
    initialState: { dir: '' },
    title: id,
    source: { kind: 'local', rootPath: null },
    layout: { bounds: { x: 10, y: 20, width: 600, height: 500 }, zIndex: 1 },
  }
}
const document: PersistedWorkspaceState = {
  workspaceType: 'desktop',
  windows: [window('a', 'group'), window('b', 'group'), window('c'), window('d')],
  activeWindowId: 'b',
  activeTabMap: { group: 'b' },
  nextWindowId: 5,
}
test('moving one group preserves every unrelated group and previous snapshots', () => {
  const before = desktopWindowGroups(document, environment)
  expect(desktopWindowGroups(document, environment, before)).toBe(before)
  const moved = {
    ...document.windows[0]!,
    layout: { ...document.windows[0]!.layout, bounds: { x: 90, y: 20, width: 600, height: 500 } },
  }
  const after = desktopWindowGroups(
    { ...document, windows: [moved, ...document.windows.slice(1)] },
    environment,
    before,
  )
  expect(after[0]).not.toBe(before[0])
  expect(after[0]?.members[0]?.layout?.bounds?.x).toBe(90)
  expect(after[1]).toBe(before[1])
  expect(after[2]).toBe(before[2])
  expect(before[0]?.members[0]?.layout?.bounds?.x).toBe(10)
})
test('focus, active tabs and split changes invalidate only affected groups', () => {
  const before = desktopWindowGroups(document, environment)
  const focused = desktopWindowGroups({ ...document, activeWindowId: 'c' }, environment, before)
  expect(focused[0]?.activeWindowId).toBeNull()
  expect(focused[1]?.activeWindowId).toBe('c')
  expect(focused[2]).toBe(before[2])
  const split = desktopWindowGroups(
    {
      ...document,
      activeTabMap: { group: 'a' },
      tabGroupSplits: { group: { leftTabId: 'a', leftPaneFraction: 0.4 } },
    },
    environment,
    before,
  )
  expect(split[0]?.visibleTabId).toBe('b')
  expect(split[0]?.split?.leftPaneFraction).toBe(0.4)
  expect(split[1]).toBe(before[1])
  const resized = desktopWindowGroups(
    { ...document, tabGroupSplits: { group: { leftTabId: 'a', leftPaneFraction: 0.7 } } },
    environment,
    split,
  )
  expect(resized[0]?.split?.leftPaneFraction).toBe(0.7)
})
test('membership, order, minimized state and read-only permissions stay current', () => {
  const before = desktopWindowGroups(document, environment)
  const changed = desktopWindowGroups(
    {
      ...document,
      windows: [
        document.windows[3]!,
        { ...document.windows[2]!, layout: { ...document.windows[2]!.layout, minimized: true } },
      ],
    },
    { ...environment, editable: false },
    before,
  )
  expect(changed.map((group) => group.groupId)).toEqual(['d', 'c'])
  expect(changed.every((group) => !group.editable)).toBe(true)
  expect(changed[1]?.members[0]?.layout?.minimized).toBe(true)
  expect(desktopWindowGroups(null, environment, changed)).toEqual([])
  expect(before[0]?.members).toHaveLength(2)
})
test('merge hints update only the dragged group and target, then clear both', () => {
  const before = desktopWindowGroups(document, environment)
  const merging = {
    ...environment,
    snap: {
      ...environment.snap,
      model: {
        ...environment.snap.model,
        dragSnapWindowId: 'a',
        mergeTargetPreview: { groupId: 'c', insertIndex: 1 },
      },
    },
  }
  const after = desktopWindowGroups(document, merging, before)
  expect(after[0]?.snap.model.mergeTargetPreview).toEqual({ groupId: 'c', insertIndex: 1 })
  expect(after[1]?.snap.model.mergeTargetPreview?.insertIndex).toBe(1)
  expect(after[2]).toBe(before[2])
  const cleared = desktopWindowGroups(document, environment, after)
  expect(cleared[0]?.snap.model.mergeTargetPreview).toBeNull()
  expect(cleared[1]?.snap.model.mergeTargetPreview).toBeNull()
  expect(cleared[2]).toBe(before[2])
})
test('presentation sources and commands are not captured stale', () => {
  const before = desktopWindowGroups(document, environment)
  const focus = () => 'new focus'
  const updated = {
    ...environment,
    content: { ...environment.content, editableFolders: ['/new'] },
    windows: { ...environment.windows, focus },
  }
  const after = desktopWindowGroups(document, updated, before)
  expect(after.every((group) => group.content.editableFolders[0] === '/new')).toBe(true)
  expect(after[0]?.windows.focus).toBe(focus)
  expect(before[0]?.content.editableFolders).toEqual([])
})
