import { describe, expect, test } from 'bun:test'
import {
  CANVAS_COLLECTION_STORAGE_KEY,
  loadCanvasCollection,
  parseCanvasRecords,
  serializeCanvasCollection,
} from '@/lib/canvas-persistence'
import { parseInfiniteCanvasState } from '@/lib/infinite-canvas'
import { applyCanvasPathMutation, applyWorkspacePathMutation } from '@/lib/workspace-path-mutation'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
} from '@/lib/use-workspace'
import canvasFixture from '../fixtures/persisted-state/reference/canvas-collection.json'
import hermesFixture from '../fixtures/persisted-state/reference/hermes-window.json'
import settingsFixture from '../fixtures/persisted-state/reference/settings.json'
import workspaceFixture from '../fixtures/persisted-state/reference/workspace-layout.json'

function storage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null }
}

describe('Persisted-state compatibility fixtures', () => {
  test('settings document retains representative Library and named-layout state', () => {
    const settings = settingsFixture['reference-library']

    expect(settings.viewModes).toEqual({ '': 'grid', Notes: 'list', Pictures: 'grid' })
    expect(settings.favorites).toEqual(['Pictures/cover.jpg', 'Notes'])
    expect(settings.knowledgeBases).toEqual(['Notes'])
    expect(settings.customIcons).toEqual({ Notes: 'NotebookTabs' })
    expect(settings.autoSave['Notes/todo.md']).toEqual({ enabled: true, readOnly: false })
    expect(settings.workspaceTaskbarPins).toHaveLength(1)
    expect(settings.workspaceLayoutPresets).toHaveLength(1)
    expect(settings.workspaceLayoutPresets[0]?.snapshot).toEqual(workspaceFixture)
    expect(
      normalizePersistedWorkspaceState(settings.workspaceLayoutPresets[0]?.snapshot),
    ).not.toBeNull()
  })

  test('workspace layout reopens browser, viewer, split, pin, and durable Hermes identity', () => {
    const rawHermes = workspaceFixture.windows.find((window) => window.id === 'reference-hermes')
    expect(rawHermes).toEqual(hermesFixture)

    const restored = normalizePersistedWorkspaceState(workspaceFixture, {
      reconcileSnapZones: false,
    })
    expect(restored).not.toBeNull()
    expect(restored?.windows.map((window) => window.type)).toEqual(['browser', 'viewer', 'hermes'])
    expect(restored?.tabGroupSplits?.['reference-main-group']).toEqual({
      leftTabId: 'reference-browser',
      leftPaneFraction: 0.42,
    })
    expect(restored?.pinnedTaskbarItems[0]?.path).toBe('Notes')
    expect(restored?.fileOpenTarget).toBe('new-tab')
    expect(restored?.windows.find((window) => window.type === 'hermes')?.hermes).toEqual({
      sessionId: 'reference-session',
      cwd: '/srv/media',
      readOnly: false,
    })

    const encoded = serializeWorkspacePersistedState(restored!)
    expect(encoded).toContain('reference-session')
    expect(encoded).not.toContain('draftId')
    expect(
      normalizePersistedWorkspaceState(JSON.parse(encoded), { reconcileSnapZones: false }),
    ).not.toBeNull()
  })

  test('canvas collection and server record array round-trip without losing Hermes or Reader state', () => {
    const rawCanvas = canvasFixture.canvases[0]?.state
    const rawHermes = rawCanvas?.windows.find((window) => window.id === 'reference-hermes')
    expect(rawHermes?.definition).toEqual(hermesFixture)
    expect(parseCanvasRecords(canvasFixture.canvases)).toHaveLength(1)

    const first = loadCanvasCollection(
      storage({ [CANVAS_COLLECTION_STORAGE_KEY]: JSON.stringify(canvasFixture) }),
    )
    expect(first.activeId).toBe('reference-canvas')
    expect(first.canvases[0]?.state?.windows.map((window) => window.definition.type)).toEqual([
      'browser',
      'viewer',
      'hermes',
    ])
    expect(first.canvases[0]?.state?.windows[1]?.definition.initialState).toMatchObject({
      viewing: 'Pictures',
      readerKind: 'folder',
    })
    expect(first.canvases[0]?.state?.windows[2]?.definition.hermes).toEqual({
      sessionId: 'reference-session',
      cwd: '/srv/media',
      readOnly: false,
    })

    const encoded = serializeCanvasCollection(first)
    const second = loadCanvasCollection(storage({ [CANVAS_COLLECTION_STORAGE_KEY]: encoded }))
    expect(second).toEqual(first)
  })

  test('representative logical paths retain current move-mutation behavior', () => {
    const workspace = normalizePersistedWorkspaceState(workspaceFixture, {
      reconcileSnapZones: false,
    })!
    const movedWorkspace = applyWorkspacePathMutation(workspace, {
      type: 'path-moved',
      oldPath: 'Notes',
      newPath: 'Archive/Notes',
    })
    expect(movedWorkspace.windows[0]?.initialState.dir).toBe('Archive/Notes')
    expect(movedWorkspace.windows[1]?.initialState.viewing).toBe('Archive/Notes/todo.md')
    expect(movedWorkspace.pinnedTaskbarItems[0]?.path).toBe('Archive/Notes')
    expect(movedWorkspace.windows[2]?.hermes?.sessionId).toBe('reference-session')

    const canvas = parseInfiniteCanvasState(canvasFixture.canvases[0]?.state)!
    const movedCanvas = applyCanvasPathMutation(canvas, {
      type: 'path-moved',
      oldPath: 'Pictures',
      newPath: 'Archive/Pictures',
    })
    expect(movedCanvas.windows[0]?.definition.initialState.dir).toBe('Archive/Pictures')
    expect(movedCanvas.windows[1]?.definition.initialState.viewing).toBe('Archive/Pictures')
    expect(movedCanvas.windows[2]?.definition.hermes?.sessionId).toBe('reference-session')
  })
})
