import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import {
  canvasSessionState,
  canvasStateToSpace,
  parseSpace,
  parseSpaceOrThrow,
  projectSpaceToCanvas,
  projectSpaceToWorkspace,
  reduceSpaceCommand,
  workspaceSessionState,
  workspaceStateToSpace,
  type Space,
} from '@/lib/space'
import { createEmptyCanvasState, type InfiniteCanvasState } from '@/lib/infinite-canvas'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'

const instant = Date.parse('2026-08-12T12:00:00.000Z')
const clock = { now: () => instant }

function paneDefinition(id: string, type: WorkspaceWindowDefinition['type'] = 'viewer') {
  return {
    id,
    type,
    title: id,
    iconPath: `Documents/${id}.md`,
    iconType: MediaType.TEXT,
    source: { kind: 'local' as const },
    initialState: { viewing: `Documents/${id}.md` },
    resourceTarget: {
      ref: { libraryId: 'library', resourceId: `resource-${id}` },
      legacyLocator: `Documents/${id}.md`,
    },
    ...(type === 'viewer' ? { viewerId: 'text-viewer' as const } : {}),
    tabGroupId: null,
  }
}

function space(overrides: Partial<Space> = {}): Space {
  return parseSpaceOrThrow({
    schemaVersion: 1,
    id: 'space-1',
    name: 'Space',
    revision: 3,
    origin: 'canvas',
    panes: {
      alpha: {
        kind: 'viewer',
        state: { title: 'Alpha', initialState: {}, source: { kind: 'local' } },
      },
    },
    arrangements: {
      spatial: {
        placements: { alpha: { bounds: { x: 0, y: 0, width: 320, height: 224 }, zIndex: 1 } },
      },
    },
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  })
}

describe('Space schema and commands', () => {
  test('strictly rejects invalid schema, panes, and dangling arrangement references', () => {
    const invalid = parseSpace({
      ...space(),
      schemaVersion: 2,
      panes: { alpha: { kind: 'iframe', state: [] } },
      arrangements: { spatial: { placements: { missing: {} } } },
    })
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'panes.alpha.kind',
        'arrangements.spatial.placements.missing',
      ]),
    )
  })

  test('accepts opaque legacy IDs while rejecting non-JSON state and malformed placements', () => {
    expect(parseSpace({ ...space(), id: 'legacy/path\\pane' }).ok).toBe(true)
    expect(parseSpace({ ...space(), id: 'control\u0000pane' }).ok).toBe(false)
    const invalid = parseSpace({
      ...space(),
      panes: { alpha: { kind: 'viewer', state: { invalid: Number.NaN } } },
      arrangements: {
        spatial: {
          placements: { alpha: { bounds: { x: 0, y: 0, width: -1, height: 100 }, zIndex: -1 } },
        },
      },
    })
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'panes.alpha.state.invalid',
        'arrangements.spatial.placements.alpha.bounds',
        'arrangements.spatial.placements.alpha.zIndex',
      ]),
    )
  })

  test('applies pane and arrangement commands without changing pane identity', () => {
    const original = space()
    const added = reduceSpaceCommand(
      original,
      {
        type: 'addPane',
        paneId: 'beta',
        pane: {
          kind: 'browser',
          state: { title: 'Beta', source: { kind: 'local' }, initialState: {} },
        },
      },
      clock,
    )
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const arranged = reduceSpaceCommand(
      added.space,
      {
        type: 'applyArrangement',
        presentation: 'tiled',
        arrangement: {
          placements: { alpha: { layout: {} }, beta: { layout: {} } },
          tabGroups: { group: ['alpha', 'beta'] },
        },
      },
      clock,
    )
    expect(arranged.ok).toBe(true)
    if (!arranged.ok) return
    expect(arranged.space.panes).toEqual(added.space.panes)
    expect(arranged.space.revision).toBe(5)

    const removed = reduceSpaceCommand(
      arranged.space,
      { type: 'removePane', paneId: 'beta' },
      clock,
    )
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.space.panes.beta).toBeUndefined()
    expect(removed.space.arrangements.tiled).toEqual({
      placements: { alpha: { layout: {} } },
      tabGroups: { group: ['alpha'] },
    })
  })

  test('supports rename, tombstone, and clean duplicate semantics', () => {
    const renamed = reduceSpaceCommand(space(), { type: 'rename', name: 'Renamed' }, clock)
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const copy = reduceSpaceCommand(
      renamed.space,
      { type: 'duplicate', newId: 'recovered-1', name: 'Renamed (recovered)' },
      clock,
    )
    expect(copy).toMatchObject({
      ok: true,
      space: { id: 'recovered-1', name: 'Renamed (recovered)', revision: 0 },
    })
    if (copy.ok) expect(copy.space.deletedAt).toBeUndefined()
    const deleted = reduceSpaceCommand(renamed.space, { type: 'delete' }, clock)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.space.deletedAt).toBe(instant)
    expect(
      reduceSpaceCommand(
        deleted.space,
        { type: 'duplicate', newId: 'cannot-copy-tombstone' },
        clock,
      ).ok,
    ).toBe(false)
  })

  test('leaves retained-snapshot restoration to SpaceEngine storage layer', () => {
    expect(reduceSpaceCommand(space(), { type: 'restoreRevision', revision: 1 }, clock)).toEqual({
      ok: false,
      code: 'invalid',
      message: 'restoreRevision requires retained server snapshot',
    })
  })

  test('treats a zero timestamp tombstone as deleted', () => {
    const tombstone = space({ deletedAt: 0 })
    expect(reduceSpaceCommand(tombstone, { type: 'rename', name: 'Nope' }, clock)).toMatchObject({
      ok: false,
      code: 'deleted',
    })
  })
})

describe('Canvas Space conversion', () => {
  function canvas(): InfiniteCanvasState {
    return {
      ...createEmptyCanvasState(),
      windows: [
        {
          id: 'canvas-window-7',
          definition: paneDefinition('canvas-window-7'),
          bounds: { x: -32, y: 64, width: 640, height: 480 },
          zIndex: 9,
        },
      ],
      camera: { x: 120, y: 80, zoom: 0.5 },
      maximizedWindowId: 'canvas-window-7',
      windowSizeByType: { viewer: { width: 704, height: 512 } },
      nextItemId: 99,
      nextZIndex: 77,
    }
  }

  test('preserves pane IDs, definitions, ResourceRefs, bounds, and z while excluding device state', () => {
    const state = canvas()
    const converted = canvasStateToSpace({ id: 'canvas-space', name: 'Canvas', state }, clock)
    expect(converted.panes['canvas-window-7']).toMatchObject({
      kind: 'viewer',
      state: {
        title: 'canvas-window-7',
        resourceTarget: paneDefinition('canvas-window-7').resourceTarget,
      },
    })
    expect(converted.arrangements.spatial).toEqual({
      placements: {
        'canvas-window-7': {
          bounds: { x: -32, y: 64, width: 640, height: 480 },
          zIndex: 9,
        },
      },
    })
    expect(JSON.stringify(converted)).not.toContain('camera')
    expect(JSON.stringify(converted)).not.toContain('maximizedWindowId')
    expect(JSON.stringify(converted)).not.toContain('windowSizeByType')
    expect(JSON.stringify(converted)).not.toContain('nextItemId')
  })

  test('round trips durable fields and reinjects device-local camera/maximized/size state', () => {
    const state = canvas()
    const session = canvasSessionState(state)
    const projected = projectSpaceToCanvas(
      canvasStateToSpace({ id: 'canvas-space', name: 'Canvas', state }, clock),
      session,
    )
    expect(projected.windows).toEqual(state.windows)
    expect(projected.camera).toEqual(state.camera)
    expect(projected.maximizedWindowId).toBe(state.maximizedWindowId)
    expect(projected.windowSizeByType).toEqual(state.windowSizeByType)
    expect(projected.nextItemId).toBe(8)
    expect(projected.nextZIndex).toBe(10)
  })

  test('round trips a canonical Canvas pane without normalizing nullable pane state', () => {
    const canonical = space({
      panes: {
        alpha: {
          kind: 'viewer',
          state: {
            title: 'Alpha',
            source: { kind: 'local' },
            initialState: {},
            tabGroupId: null,
          },
        },
      },
    })
    const projected = projectSpaceToCanvas(canonical)
    const roundTripped = canvasStateToSpace({
      id: canonical.id,
      name: canonical.name,
      state: projected,
      revision: canonical.revision,
      createdAt: canonical.createdAt,
      updatedAt: canonical.updatedAt,
    })
    expect(roundTripped.panes).toEqual(canonical.panes)
  })

  test('keeps an unplaced pane visible with deterministic default geometry', () => {
    const converted = space({
      panes: {
        alpha: { kind: 'viewer', state: paneDefinition('alpha') },
        beta: { kind: 'browser', state: paneDefinition('beta', 'browser') },
      },
      arrangements: { spatial: { placements: {} } },
    })
    const projected = projectSpaceToCanvas(converted)
    expect(projected.windows.map((window) => window.id)).toEqual(['alpha', 'beta'])
    expect(projected.windows.map((window) => window.bounds)).toEqual([
      { x: 0, y: 0, width: 640, height: 480 },
      { x: 32, y: 32, width: 640, height: 480 },
    ])
  })
})

describe('Workspace Space conversion', () => {
  function workspace(): PersistedWorkspaceState {
    const alpha = {
      ...paneDefinition('workspace-window-4', 'browser'),
      initialState: { dir: 'Documents' },
      tabGroupId: 'group-1',
      layout: {
        bounds: { x: 0, y: 0, width: 600, height: 700 },
        zIndex: 5,
        tiling: {
          cols: 2,
          rows: 1,
          colStart: 0,
          colEnd: 1,
          rowStart: 0,
          rowEnd: 1,
          colLines: [0, 0.5, 1],
          rowLines: [0, 1],
        },
      },
    }
    const beta = {
      ...paneDefinition('workspace-window-9'),
      tabGroupId: 'group-1',
      layout: { bounds: { x: 0, y: 0, width: 600, height: 700 }, zIndex: 5 },
    }
    return {
      windows: [alpha, beta],
      activeWindowId: beta.id,
      activeTabMap: { 'group-1': beta.id },
      nextWindowId: 44,
      pinnedTaskbarItems: [
        {
          id: 'pin',
          path: 'Music',
          title: 'Music',
          isDirectory: true,
          source: { kind: 'local' },
        },
      ],
      tabGroupSplits: { 'group-1': { leftTabId: alpha.id, leftPaneFraction: 0.42 } },
      browserTabTitle: 'Private title',
      browserTabIcon: 'Folder',
      browserTabIconColor: 'blue',
      fileOpenTarget: 'new-tab',
    }
  }

  test('preserves definitions and tiled geometry while excluding local focus and preferences', () => {
    const state = workspace()
    const converted = workspaceStateToSpace(
      { id: 'workspace-space', name: 'Workspace', state },
      clock,
    )
    expect(converted.panes['workspace-window-4']?.state.resourceTarget).toEqual(
      state.windows[0]?.resourceTarget,
    )
    expect(converted.arrangements.tiled).toMatchObject({
      placements: {
        'workspace-window-4': { layout: state.windows[0]?.layout },
        'workspace-window-9': { layout: state.windows[1]?.layout },
      },
      tabGroups: { 'group-1': ['workspace-window-4', 'workspace-window-9'] },
      splits: { 'group-1': { leftPaneId: 'workspace-window-4', leftPaneFraction: 0.42 } },
    })
    const encoded = JSON.stringify(converted)
    for (const localField of [
      'activeWindowId',
      'activeTabMap',
      'nextWindowId',
      'pinnedTaskbarItems',
      'browserTabTitle',
      'browserTabIcon',
      'browserTabIconColor',
      'fileOpenTarget',
    ]) {
      expect(encoded).not.toContain(localField)
    }
  })

  test('round trips durable state and injects per-device focus, pins, and preferences', () => {
    const state = workspace()
    const session = workspaceSessionState(state)
    const projected = projectSpaceToWorkspace(
      workspaceStateToSpace({ id: 'workspace-space', name: 'Workspace', state }, clock),
      session,
    )
    expect(projected).toEqual(state)

    const otherDevice = projectSpaceToWorkspace(
      workspaceStateToSpace({ id: 'workspace-space', name: 'Workspace', state }, clock),
    )
    expect(otherDevice.activeWindowId).toBeNull()
    expect(otherDevice.activeTabMap).toEqual({})
    expect(otherDevice.pinnedTaskbarItems).toEqual([])
    expect(otherDevice.browserTabTitle).toBeUndefined()
    expect(otherDevice.fileOpenTarget).toBeUndefined()
  })

  test('retains pane order after a server-sorted pane map round trip', () => {
    const state = workspace()
    state.windows = [state.windows[1]!, state.windows[0]!]
    const converted = workspaceStateToSpace(
      { id: 'workspace-space', name: 'Workspace', state },
      clock,
    )
    converted.panes = Object.fromEntries(
      Object.entries(converted.panes).sort(([left], [right]) => left.localeCompare(right)),
    )
    expect(projectSpaceToWorkspace(converted).windows.map((window) => window.id)).toEqual(
      state.windows.map((window) => window.id),
    )
  })

  test('excludes draft assistant windows but preserves cwd for durable assistants', () => {
    const state = workspace()
    state.windows = [
      {
        ...paneDefinition('draft', 'hermes'),
        hermes: { draftId: 'transient', cwd: 'Documents' },
      },
      {
        ...paneDefinition('durable', 'hermes'),
        hermes: { sessionId: 'session-1', draftId: 'transient', cwd: 'Documents' },
      },
    ]
    const converted = workspaceStateToSpace(
      { id: 'workspace-space', name: 'Workspace', state },
      clock,
    )
    expect(Object.keys(converted.panes)).toEqual(['durable'])
    expect(converted.panes.durable?.state.hermes).toEqual({
      sessionId: 'session-1',
      cwd: 'Documents',
    })
  })
})
