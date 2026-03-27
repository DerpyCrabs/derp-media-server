import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  insertIndexAfterAllRightTabs,
  mergeInsertIndexToRightStripSlot,
  resolveGroupVisibleTabId,
  rightStripIndexToGroupInsertIndex,
  tabsInGroup,
  visibleTabIdAfterPlayerRemoved,
} from '@/src/workspace/tab-group-ops'

function browserTab(id: string, gid = 'g1'): WorkspaceWindowDefinition {
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
  }
}

function viewerTab(id: string, gid = 'g1'): WorkspaceWindowDefinition {
  return {
    id,
    type: 'viewer',
    title: id,
    iconName: null,
    iconPath: '/f',
    iconType: MediaType.OTHER,
    iconIsVirtual: false,
    source: { kind: 'local', rootPath: null },
    initialState: { dir: '/', viewing: '/f' },
    tabGroupId: gid,
    layout: { minimized: false, zIndex: 1 },
  }
}

describe('resolveGroupVisibleTabId', () => {
  test('with split, maps active left to right pane tab', () => {
    const windows = [browserTab('b1'), viewerTab('v1')]
    const id = resolveGroupVisibleTabId(
      {
        windows,
        activeTabMap: { g1: 'b1' },
        tabGroupSplits: { g1: { leftTabId: 'b1', leftPaneFraction: 0.5 } },
      },
      'g1',
    )
    expect(id).toBe('v1')
  })

  test('with split, keeps right tab when active is right', () => {
    const windows = [browserTab('b1'), viewerTab('v1')]
    expect(
      resolveGroupVisibleTabId(
        {
          windows,
          activeTabMap: { g1: 'v1' },
          tabGroupSplits: { g1: { leftTabId: 'b1', leftPaneFraction: 0.5 } },
        },
        'g1',
      ),
    ).toBe('v1')
  })

  test('without split, uses activeTabMap when member is valid', () => {
    const windows = [browserTab('a'), viewerTab('b')]
    expect(
      resolveGroupVisibleTabId(
        { windows, activeTabMap: { g1: 'b' }, tabGroupSplits: undefined },
        'g1',
      ),
    ).toBe('b')
  })

  test('without split and missing map, prefers first tab', () => {
    const windows = [browserTab('a'), viewerTab('b')]
    expect(
      resolveGroupVisibleTabId({ windows, activeTabMap: {}, tabGroupSplits: undefined }, 'g1'),
    ).toBe('a')
  })
})

describe('visibleTabIdAfterPlayerRemoved', () => {
  test('with split, returns non-left member', () => {
    const windows = [browserTab('b1'), viewerTab('v1')]
    expect(
      visibleTabIdAfterPlayerRemoved(windows, 'g1', {
        g1: { leftTabId: 'b1', leftPaneFraction: 0.5 },
      }),
    ).toBe('v1')
  })

  test('without split, prefers a viewer', () => {
    const windows = [browserTab('a'), viewerTab('b')]
    expect(visibleTabIdAfterPlayerRemoved(windows, 'g1', undefined)).toBe('b')
  })

  test('without split and no viewer, returns last tab', () => {
    const windows = [browserTab('a'), browserTab('b')]
    expect(visibleTabIdAfterPlayerRemoved(windows, 'g1', undefined)).toBe('b')
  })
})

describe('split strip insert index helpers', () => {
  test('insertIndexAfterAllRightTabs appends after last non-left tab', () => {
    const group = [browserTab('L'), viewerTab('r1'), viewerTab('r2')]
    expect(insertIndexAfterAllRightTabs(group, 'L')).toBe(3)
  })

  test('rightStripIndexToGroupInsertIndex without split is identity', () => {
    const group = [browserTab('a'), viewerTab('b')]
    expect(rightStripIndexToGroupInsertIndex(group, undefined, 0)).toBe(0)
    expect(rightStripIndexToGroupInsertIndex(group, undefined, 1)).toBe(1)
    expect(rightStripIndexToGroupInsertIndex(group, undefined, 2)).toBe(2)
  })

  test('rightStripIndexToGroupInsertIndex maps right strip back to full order', () => {
    const group = tabsInGroup([browserTab('left'), viewerTab('u'), viewerTab('v')], 'g1')
    expect(rightStripIndexToGroupInsertIndex(group, 'left', 0)).toBe(1)
    expect(rightStripIndexToGroupInsertIndex(group, 'left', 1)).toBe(2)
    expect(rightStripIndexToGroupInsertIndex(group, 'left', 2)).toBe(3)
  })

  test('mergeInsertIndexToRightStripSlot inverts full index for split group', () => {
    const group = [browserTab('L'), viewerTab('a'), viewerTab('b')]
    expect(mergeInsertIndexToRightStripSlot(group, 'L', 0)).toBe(0)
    expect(mergeInsertIndexToRightStripSlot(group, 'L', 1)).toBe(0)
    expect(mergeInsertIndexToRightStripSlot(group, 'L', 2)).toBe(1)
    expect(mergeInsertIndexToRightStripSlot(group, 'L', 3)).toBe(2)
  })

  test('mergeInsertIndexToRightStripSlot without split is identity', () => {
    const group = [browserTab('a'), browserTab('b')]
    expect(mergeInsertIndexToRightStripSlot(group, undefined, 1)).toBe(1)
  })
})
