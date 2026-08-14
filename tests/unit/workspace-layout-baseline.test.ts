import { describe, expect, test } from 'bun:test'
import { createRoot, createSignal } from 'solid-js'
import { MediaType } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { useWorkspacePageLayoutBaseline } from '@/src/workspace/workspace-page/use-workspace-page-layout-baseline'

function browserWindow(id: string, path: string): WorkspaceWindowDefinition {
  return {
    id,
    type: 'browser',
    title: path,
    iconType: MediaType.FOLDER,
    source: { kind: 'local' },
    initialState: { dir: path },
  }
}

function workspace(windows: WorkspaceWindowDefinition[]): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows.at(-1)?.id ?? null,
    activeTabMap: {},
    nextWindowId: windows.length + 1,
    pinnedTaskbarItems: [],
  }
}

describe('workspace layout baseline', () => {
  test('reverts a live baseline after persistence switches to content envelopes', () => {
    createRoot((dispose) => {
      const first = browserWindow('browser-1', 'Pictures')
      const second = browserWindow('browser-2', 'Documents')
      const [state, setState] = createSignal<PersistedWorkspaceState | null>(workspace([first]))
      const baseline = useWorkspacePageLayoutBaseline(state, setState)

      baseline.syncLayoutBaselineToCurrent()
      setState(workspace([first, second]))

      baseline.revertLayoutToBaseline()

      expect(state()?.windows.map((window) => window.id)).toEqual(['browser-1'])
      expect(state()?.windows[0]).toMatchObject({
        type: 'browser',
        initialState: { dir: 'Pictures' },
      })
      dispose()
    })
  })
})
