import { expect, test } from 'bun:test'
import type { WindowDefinition } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import { createCanvasScene } from '@/workspace/canvas/model/canvas-scene'

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

test('canvas scene preserves group order, active tabs and window geometry', () => {
  const document: PersistedWorkspaceState = {
    workspaceType: 'canvas',
    windows: [window('a', 'group'), window('b'), window('c', 'group')],
    activeWindowId: 'c',
    activeTabMap: { group: 'c', b: 'missing' },
    nextWindowId: 4,
  }
  const scene = createCanvasScene(document)
  expect(scene.groupIds).toEqual(['group', 'b'])
  expect(scene.groups.get('group')?.map((item) => item.id)).toEqual(['a', 'c'])
  expect(scene.activeWindows.get('group')?.id).toBe('c')
  expect(scene.activeWindows.get('b')?.id).toBe('b')
  expect(scene.tabs.get('group')).toEqual([document.windows[0], document.windows[2]])
  expect(scene.definitions.get('c')).toBe(document.windows[2])
  expect(scene.activeWindows.get('group')?.bounds).toEqual({
    x: 10,
    y: 20,
    width: 600,
    height: 500,
  })
})

test('removing or regrouping windows does not leave stale tabs or change the previous scene', () => {
  const document: PersistedWorkspaceState = {
    workspaceType: 'canvas',
    windows: [window('a', 'group'), window('b', 'group')],
    activeWindowId: 'b',
    activeTabMap: { group: 'b' },
    nextWindowId: 3,
  }
  const previous = createCanvasScene(document)
  const removed = createCanvasScene({ ...document, windows: [document.windows[0]!] })
  expect(removed.activeWindows.get('group')?.id).toBe('a')
  expect(removed.definitions.has('b')).toBe(false)
  const regrouped = createCanvasScene({ ...document, windows: [window('a'), window('b')] })
  expect(regrouped.groupIds).toEqual(['a', 'b'])
  expect(regrouped.groups.has('group')).toBe(false)
  expect(previous.activeWindows.get('group')?.id).toBe('b')
  expect(previous.tabs.get('group')).toHaveLength(2)
  const empty = createCanvasScene({ ...document, windows: [] })
  expect(empty.groupIds).toEqual([])
})

test('focus and geometry changes retain unrelated group and camera identities', () => {
  const document: PersistedWorkspaceState = {
    workspaceType: 'canvas',
    windows: [window('a'), window('b')],
    activeWindowId: 'a',
    activeTabMap: {},
    nextWindowId: 3,
  }
  const initial = createCanvasScene(document)
  const focused = createCanvasScene({ ...document, activeWindowId: 'b' }, initial)
  expect(focused.state).toBe(initial.state)
  expect(focused.groupIds).toBe(initial.groupIds)
  expect(focused.groups.get('a')).toBe(initial.groups.get('a'))
  expect(focused.tabs.get('b')).toBe(initial.tabs.get('b'))
  const movedDefinition = {
    ...document.windows[0]!,
    layout: { ...document.windows[0]!.layout, bounds: { x: 50, y: 20, width: 600, height: 500 } },
  }
  const moved = createCanvasScene(
    { ...document, windows: [movedDefinition, document.windows[1]!] },
    focused,
  )
  expect(moved.activeWindows.get('a')?.bounds.x).toBe(50)
  expect(moved.groups.get('a')).not.toBe(focused.groups.get('a'))
  expect(moved.tabs.get('a')).not.toBe(focused.tabs.get('a'))
  expect(moved.groups.get('b')).toBe(focused.groups.get('b'))
  expect(moved.tabs.get('b')).toBe(focused.tabs.get('b'))
  expect(moved.state.camera).toBe(focused.state.camera)
  expect(initial.activeWindows.get('a')?.bounds.x).toBe(10)
})
