import { describe, expect, test } from 'bun:test'
import {
  closeWorkspaceWindows,
  confirmWorkspaceWindowsSequentially,
} from '@/workspace/model/workspace-close'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'

const window = (id: string, group: string | null = null): WorkspaceWindowDefinition => ({
  id,
  type: 'browser',
  title: id,
  source: { kind: 'local' },
  initialState: {},
  tabGroupId: group,
})

function state(windows: WorkspaceWindowDefinition[]): PersistedWorkspaceState {
  return {
    workspaceType: 'desktop',
    windows,
    activeWindowId: windows.at(-1)?.id ?? null,
    activeTabMap: { group: 'two' },
    nextWindowId: 5,
  }
}

describe('workspace close transaction', () => {
  test('closes selected tabs as one transition and preserves unrelated group invariants', () => {
    const latest = state([
      window('leader', 'group'),
      window('middle', 'group'),
      window('right', 'group'),
      window('other'),
    ])
    latest.activeWindowId = 'middle'
    latest.activeTabMap = { group: 'middle' }
    latest.tabGroupSplits = { group: { leftTabId: 'leader', leftPaneFraction: 0.4 } }
    latest.workspaceType = 'canvas'
    latest.canvas = {
      camera: { x: 0, y: 0, zoom: 1 },
      maximizedWindowId: 'middle',
      windowSizeByType: {},
      nextZIndex: 5,
    }

    const result = closeWorkspaceWindows(latest, new Set(['leader', 'middle']))

    expect(result.removed.map((item) => item.id)).toEqual(['leader', 'middle'])
    expect(result.state.windows.map((item) => item.id)).toEqual(['right', 'other'])
    expect(result.state.windows[0]?.tabGroupId).toBeNull()
    expect(result.state.activeWindowId).toBe('other')
    expect(result.state.activeTabMap).toEqual({})
    expect(result.state.tabGroupSplits).toBeUndefined()
    expect(result.state.canvas?.maximizedWindowId).toBeNull()
  })

  test('stops confirmations after first cancellation', async () => {
    const calls: string[] = []
    const windows = [window('one'), window('two'), window('three')]
    const allowed = await confirmWorkspaceWindowsSequentially(windows, async () => {
      calls.push(windows[calls.length]!.id)
      return calls.length < 2
    })

    expect(allowed).toBe(false)
    expect(calls).toEqual(['one', 'two'])
  })

  test('applies confirmed removals to latest state without losing concurrent windows', () => {
    const latest = state([window('one', 'group'), window('two', 'group'), window('concurrent')])
    const result = closeWorkspaceWindows(latest, new Set(['one', 'two']))

    expect(result.state.windows.map((item) => item.id)).toEqual(['concurrent'])
    expect(result.state.activeWindowId).toBe('concurrent')
    expect(result.state.activeTabMap).toEqual({})
  })

  test('dissolves a group when only one unremoved member remains', () => {
    const latest = state([window('one', 'group'), window('two', 'group'), window('new', 'group')])
    const result = closeWorkspaceWindows(latest, new Set(['one', 'two']))

    expect(result.state.windows).toEqual([window('new')])
    expect(result.state.activeWindowId).toBe('new')
    expect(result.state.activeTabMap).toEqual({})
  })

  test('rekeys a surviving group when its leader id is removed', () => {
    const latest = state([
      window('leader', 'leader'),
      window('second', 'leader'),
      window('third', 'leader'),
    ])
    latest.activeTabMap = { leader: 'third' }
    latest.tabGroupSplits = { leader: { leftTabId: 'second', leftPaneFraction: 0.4 } }

    const result = closeWorkspaceWindows(latest, new Set(['leader']))

    expect(result.state.windows).toEqual([window('second', 'second'), window('third', 'second')])
    expect(result.state.activeTabMap).toEqual({ second: 'third' })
    expect(result.state.tabGroupSplits).toEqual({
      second: { leftTabId: 'second', leftPaneFraction: 0.4 },
    })
  })

  test('keeps active focus in surviving group when closing its old leader', () => {
    const latest = state([
      window('leader', 'leader'),
      window('left', 'leader'),
      window('right', 'leader'),
      window('other'),
    ])
    latest.activeWindowId = 'left'
    latest.activeTabMap = { leader: 'left' }

    const result = closeWorkspaceWindows(latest, new Set(['leader']))

    expect(result.state.activeWindowId).toBe('left')
    expect(result.state.activeTabMap).toEqual({ left: 'left' })
    expect(result.state.windows.slice(0, 2).map((item) => item.tabGroupId)).toEqual([
      'left',
      'left',
    ])
  })
})
