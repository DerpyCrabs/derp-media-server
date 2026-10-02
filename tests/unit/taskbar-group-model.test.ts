import { expect, test } from 'bun:test'
import { taskbarGroupModel } from '@/workspace/desktop/taskbar-group-model'
import type { PersistedWindowState, WindowDefinition } from '@/lib/models/window-model'

function window(id: string): WindowDefinition {
  return {
    id,
    type: 'browser',
    title: id,
    source: { kind: 'local' },
    initialState: { dir: id },
    tabGroupId: 'group',
    layout: { bounds: { x: 1, y: 2, width: 600, height: 400 } },
  }
}
function workspace(): PersistedWindowState {
  return {
    workspaceType: 'desktop',
    windows: [window('first'), window('second')],
    activeWindowId: 'second',
    activeTabMap: { group: 'second' },
    nextWindowId: 3,
  }
}

test('taskbar follows the visible tab while restoring and minimizing the group leader', () => {
  const model = taskbarGroupModel(workspace(), 'group')
  expect(model).toMatchObject({
    leaderId: 'first',
    visibleId: 'second',
    count: 2,
    active: true,
    minimized: false,
  })
  expect(model.window?.title).toBe('second')
})

test('position, size and stacking changes do not publish a taskbar row', () => {
  const before = workspace()
  const after = {
    ...before,
    windows: before.windows.map((item) => ({
      ...item,
      layout: { ...item.layout, bounds: { x: 100, y: 200, width: 800, height: 500 }, zIndex: 12 },
    })),
  }
  expect(taskbarGroupModel(after, 'group')).toEqual(taskbarGroupModel(before, 'group'))
})

test('minimization, title changes and selected tab still update the taskbar', () => {
  const before = workspace()
  const minimized = {
    ...before,
    windows: before.windows.map((item) => ({
      ...item,
      layout: { ...item.layout, minimized: true },
    })),
  }
  expect(taskbarGroupModel(minimized, 'group').minimized).toBe(true)
  const activated = { ...before, activeTabMap: { group: 'first' } }
  expect(taskbarGroupModel(activated, 'group').window?.title).toBe('first')
  const renamed = {
    ...before,
    windows: before.windows.map((item) =>
      item.id === 'second' ? { ...item, title: 'Renamed' } : item,
    ),
  }
  expect(taskbarGroupModel(renamed, 'group').window?.title).toBe('Renamed')
})
