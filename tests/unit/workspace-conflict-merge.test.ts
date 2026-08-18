import { describe, expect, test } from 'bun:test'
import {
  mergeWorkspaceConflict,
  shareWorkspaceReferences,
} from '../../src/workspace/model/workspace-conflict-merge'
import type { PersistedWorkspaceState } from '../../src/workspace/model/use-workspace'

function state(): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'reader',
        type: 'viewer',
        title: 'Old',
        source: { kind: 'local' },
        layout: { bounds: { x: 10, y: 10, width: 500, height: 400 } },
        initialState: { viewing: 'Books/Old/chapter.pdf' },
      },
    ],
    activeWindowId: 'reader',
    activeTabMap: { reader: 'reader' },
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
}

describe('workspace conflict merge', () => {
  test('keeps local layout edits while accepting server path repairs', () => {
    const base = state()
    const local = structuredClone(base)
    local.windows[0].layout!.bounds!.x = 240
    const server = structuredClone(base)
    server.windows[0].initialState.viewing = 'Books/New/chapter.pdf'

    const merged = mergeWorkspaceConflict(base, local, server)

    expect(merged.windows[0].layout!.bounds!.x).toBe(240)
    expect(merged.windows[0].initialState.viewing).toBe('Books/New/chapter.pdf')
  })

  test('does not resurrect a window deleted by server repair', () => {
    const base = state()
    const local = structuredClone(base)
    local.windows[0].layout!.bounds!.x = 240
    const server = structuredClone(base)
    server.windows = []
    server.activeWindowId = null

    expect(mergeWorkspaceConflict(base, local, server).windows).toEqual([])
  })

  test('preserves unchanged window references while applying another window update', () => {
    const current = state()
    current.windows.push({
      ...structuredClone(current.windows[0]),
      id: 'second',
      title: 'Second',
    })
    const next = structuredClone(current)
    next.windows[1].title = 'Updated'

    const shared = shareWorkspaceReferences(current, next)

    expect(shared.windows[0]).toBe(current.windows[0])
    expect(shared.windows[1]).not.toBe(current.windows[1])
  })
})
