import { describe, expect, test } from 'bun:test'
import { createRoot } from 'solid-js'
import { createHermesChatUiState } from '@/features/hermes/hermes-chat-ui-state'
import { createCanvasOverlayState } from '@/workspace/canvas/model/canvas-overlay-state'
import { resolveCanvasSelection } from '@/workspace/canvas/model/canvas-selection'
import type { PersistedWindowState } from '@/lib/models/window-model'

function workspace(activeWindowId: string | null, ids: string[]): PersistedWindowState {
  return {
    workspaceType: 'canvas',
    windows: ids.map((id) => ({
      id,
      type: 'browser',
      title: id,
      source: { kind: 'local', rootPath: null },
      initialState: {},
    })),
    activeWindowId,
    activeTabMap: {},
    nextWindowId: ids.length + 1,
  }
}

describe('component state models', () => {
  test('a stale Hermes dialog close cannot dismiss a newer dialog', () => {
    createRoot((dispose) => {
      const state = createHermesChatUiState()
      state.dialogs.openImage('/preview.png')
      state.dialogs.openRename('New name')
      state.dialogs.close('image')

      expect(state.dialogs.renameOpen()).toBe(true)
      expect(state.dialogs.renameValue()).toBe('New name')
      expect(state.dialogs.previewImage()).toBeNull()
      dispose()
    })
  })

  test('Hermes prompt history owns deduplication and navigation', () => {
    createRoot((dispose) => {
      const state = createHermesChatUiState()
      state.promptHistory.record('first')
      state.promptHistory.record('second')
      state.promptHistory.record('first')

      expect(state.promptHistory.navigate('older')).toBe('first')
      expect(state.promptHistory.navigate('older')).toBe('second')
      expect(state.promptHistory.navigate('newer')).toBe('first')
      state.promptHistory.resetCursor()
      expect(state.promptHistory.navigate('newer')).toBe('')
      dispose()
    })
  })

  test('canvas menus are exclusive and stale closes preserve the active menu', () => {
    createRoot((dispose) => {
      const state = createCanvasOverlayState()
      state.canvasMenu.open({ kind: 'canvas', clientX: 1, clientY: 2, worldX: 3, worldY: 4 })
      state.pinMenu.open({ x: 5, y: 6, pinId: 'pin' })
      state.canvasMenu.close()

      expect(state.canvasMenu.value()).toBeNull()
      expect(state.pinMenu.value()).toEqual({ x: 5, y: 6, pinId: 'pin' })
      dispose()
    })
  })

  test('canvas selection follows external focus and removes deleted windows', () => {
    const changedFocus = resolveCanvasSelection(
      { activeWindowId: 'a', focusedId: 'a', selectedIds: ['a', 'b'] },
      workspace('b', ['a', 'b']),
    )
    expect(changedFocus).toEqual({ activeWindowId: 'b', focusedId: 'b', selectedIds: ['b'] })

    expect(
      resolveCanvasSelection(
        { activeWindowId: 'b', focusedId: 'a', selectedIds: ['a', 'b'] },
        workspace('b', ['b']),
      ),
    ).toEqual({ activeWindowId: 'b', focusedId: null, selectedIds: ['b'] })
  })
})
