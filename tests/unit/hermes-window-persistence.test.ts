import { describe, expect, test } from 'bun:test'
import {
  createEmptyCanvasState,
  parseInfiniteCanvasState,
  serializeInfiniteCanvasState,
} from '@/lib/infinite-canvas'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  type PersistedWorkspaceState,
  type WorkspaceWindowDefinition,
} from '@/lib/use-workspace'

function hermesWindow(id: string, sessionId?: string): WorkspaceWindowDefinition {
  return {
    id,
    type: 'hermes',
    title: 'Hermes',
    source: { kind: 'local' },
    initialState: {},
    hermes: { sessionId, draftId: 'ephemeral-draft', cwd: 'C:/repo' },
  }
}

describe('Hermes window persistence boundary', () => {
  test('workspace persists durable session identity but never draft identity', () => {
    const state: PersistedWorkspaceState = {
      windows: [hermesWindow('draft'), hermesWindow('saved', 'durable-1')],
      activeWindowId: 'saved',
      activeTabMap: {},
      nextWindowId: 3,
      pinnedTaskbarItems: [],
    }
    const encoded = serializeWorkspacePersistedState(state)
    expect(encoded).not.toContain('ephemeral-draft')
    expect(encoded).not.toContain('"id":"draft"')
    expect(encoded).toContain('durable-1')
    const restored = normalizePersistedWorkspaceState(JSON.parse(encoded), {
      reconcileSnapZones: false,
    })
    expect(restored?.windows.map((window) => window.hermes?.sessionId)).toEqual(['durable-1'])
  })

  test('canvas drops drafts and restores durable Hermes windows', () => {
    const state = createEmptyCanvasState()
    state.windows = [
      {
        id: 'draft',
        definition: hermesWindow('draft'),
        bounds: { x: 0, y: 0, width: 640, height: 480 },
        zIndex: 1,
      },
      {
        id: 'saved',
        definition: hermesWindow('saved', 'durable-2'),
        bounds: { x: 640, y: 0, width: 640, height: 480 },
        zIndex: 2,
      },
    ]
    const encoded = serializeInfiniteCanvasState(state)
    expect(encoded).not.toContain('ephemeral-draft')
    const restored = parseInfiniteCanvasState(JSON.parse(encoded))
    expect(restored?.windows).toHaveLength(1)
    expect(restored?.windows[0]?.definition.hermes?.sessionId).toBe('durable-2')
    expect(restored?.windows[0]?.definition.hermes?.cwd).toBe('C:/repo')
  })
})
