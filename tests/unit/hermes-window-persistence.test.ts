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
import { deletedHermesSessionIds } from '@/lib/hermes-session-store'

function hermesWindow(id: string, sessionId?: string): WorkspaceWindowDefinition {
  return {
    id,
    type: 'integration',
    title: 'Hermes',
    source: { kind: 'local' },
    initialState: {},
    runtimeContent: {
      id,
      type: 'integration',
      integration: 'hermes',
      view: 'chat',
      state: { sessionId, draftId: 'ephemeral-draft', cwd: 'C:/repo' },
    },
  }
}

function hermesState(window: WorkspaceWindowDefinition | undefined) {
  const content = window?.runtimeContent
  return content?.type === 'integration' && typeof content.state === 'object'
    ? (content.state as Record<string, unknown>)
    : undefined
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
    expect(restored?.windows.map((window) => hermesState(window)?.sessionId)).toEqual(['durable-1'])
  })

  test('workspace repairs focus after filtering active Hermes draft', () => {
    const durable = { ...hermesWindow('saved', 'durable-1'), tabGroupId: 'group-1' }
    const draft = { ...hermesWindow('draft'), tabGroupId: 'group-1' }
    const state: PersistedWorkspaceState = {
      windows: [durable, draft],
      activeWindowId: 'draft',
      activeTabMap: { 'group-1': 'draft' },
      nextWindowId: 3,
      pinnedTaskbarItems: [],
    }

    const persisted = JSON.parse(serializeWorkspacePersistedState(state)) as PersistedWorkspaceState

    expect(persisted.windows.map((window) => window.id)).toEqual(['saved'])
    expect(persisted.activeWindowId).toBe('saved')
    expect(persisted.activeTabMap).toEqual({})
    const restored = normalizePersistedWorkspaceState(persisted, {
      reconcileSnapZones: false,
    })
    expect(restored?.activeWindowId).toBe('saved')
    expect(restored?.activeTabMap).toEqual({})
  })

  test('does not resurrect a deleted restored session from its stored envelope', () => {
    const state: PersistedWorkspaceState = {
      windows: [hermesWindow('saved', 'deleted-session')],
      activeWindowId: 'saved',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    const restored = normalizePersistedWorkspaceState(
      JSON.parse(serializeWorkspacePersistedState(state)),
      { reconcileSnapZones: false },
    )!

    deletedHermesSessionIds.add('deleted-session')
    try {
      expect(JSON.parse(serializeWorkspacePersistedState(restored)).windows).toEqual([])
    } finally {
      deletedHermesSessionIds.delete('deleted-session')
    }
  })

  test('does not persist a live draft through a stale durable envelope', () => {
    const state: PersistedWorkspaceState = {
      windows: [hermesWindow('saved', 'previous-session')],
      activeWindowId: 'saved',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    const restored = normalizePersistedWorkspaceState(
      JSON.parse(serializeWorkspacePersistedState(state)),
      { reconcileSnapZones: false },
    )!
    restored.windows[0] = {
      ...restored.windows[0]!,
      runtimeContent: {
        id: 'saved',
        type: 'integration',
        integration: 'hermes',
        view: 'chat',
        state: { draftId: 'new-draft', cwd: 'C:/repo' },
      },
    }

    expect(JSON.parse(serializeWorkspacePersistedState(restored)).windows).toEqual([])
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
    expect(hermesState(restored?.windows[0]?.definition)?.sessionId).toBe('durable-2')
    expect(hermesState(restored?.windows[0]?.definition)?.cwd).toBe('C:/repo')
  })
})
