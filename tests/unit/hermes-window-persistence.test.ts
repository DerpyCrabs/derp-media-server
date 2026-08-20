import { describe, expect, test } from 'bun:test'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  type PersistedWorkspaceState,
} from '@/workspace/model/use-workspace'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'

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
      workspaceType: 'desktop',
      windows: [hermesWindow('draft'), hermesWindow('saved', 'durable-1')],
      activeWindowId: 'saved',
      activeTabMap: {},
      nextWindowId: 3,
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

  test('workspace repairs focus after filtering active Hermes draft', () => {
    const durable = { ...hermesWindow('saved', 'durable-1'), tabGroupId: 'group-1' }
    const draft = { ...hermesWindow('draft'), tabGroupId: 'group-1' }
    const state: PersistedWorkspaceState = {
      workspaceType: 'desktop',
      windows: [durable, draft],
      activeWindowId: 'draft',
      activeTabMap: { 'group-1': 'draft' },
      nextWindowId: 3,
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
})
