import { describe, expect, test } from 'bun:test'
import {
  createWorkspaceTransferMachine,
  transferWorkspaceGroups,
} from '@/workspace/model/workspace-transfer'
import { closeWorkspaceWindows } from '@/workspace/model/workspace-close'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'

const state = (type: 'desktop' | 'canvas'): PersistedWorkspaceState => ({
  workspaceType: type,
  windows: [],
  activeWindowId: null,
  activeTabMap: {},
  nextWindowId: 3,
  ...(type === 'canvas'
    ? {
        canvas: {
          camera: { x: 0, y: 0, zoom: 1 },
          maximizedWindowId: null,
          windowSizeByType: {},
          nextZIndex: 1,
        },
      }
    : {}),
})

describe('workspace group transfer', () => {
  test('requires current hover target for arm and end', () => {
    const machine = createWorkspaceTransferMachine()
    const started = machine.begin('source', ['window'])
    machine.hover('destination-a')
    machine.arm('destination-a', started.generation)
    machine.hover('destination-b')

    expect(machine.getState().phase).toBe('dragging')
    expect(machine.end('destination-a').commit).toBeUndefined()
    expect(machine.getState().phase).toBe('idle')
  })

  test('rejects stale arm completion after hover changes', () => {
    const machine = createWorkspaceTransferMachine()
    const started = machine.begin('source', ['window'])
    machine.hover('destination-a')
    machine.hover('destination-b')

    machine.arm('destination-a', started.generation)

    expect(machine.getState()).toMatchObject({
      phase: 'dragging',
      hoverTargetId: 'destination-b',
      armedTargetId: null,
    })
  })

  test('commits only armed current target and cancels cleanly', () => {
    const machine = createWorkspaceTransferMachine()
    const started = machine.begin('source', ['one', 'one', 'two'])
    machine.hover('destination')
    machine.arm('destination', started.generation)

    const result = machine.end('destination')

    expect(result.commit).toEqual({
      sourceId: 'source',
      destinationId: 'destination',
      windowIds: ['one', 'two'],
      generation: started.generation,
    })
    expect(machine.cancel()).toMatchObject({ phase: 'idle', sourceId: null })
  })

  test('commits a drop on the current hover target without requiring dwell', () => {
    const machine = createWorkspaceTransferMachine()
    const started = machine.begin('source', ['window'])
    machine.hover('destination')

    expect(machine.end('destination').commit).toEqual({
      sourceId: 'source',
      destinationId: 'destination',
      windowIds: ['window'],
      generation: started.generation,
    })
  })

  test('does not merge a rekeyed group into a destination window with the deleted leader id', () => {
    const source = state('desktop')
    source.windows = ['leader', 'second', 'third'].map((id) => ({
      id,
      type: 'browser' as const,
      title: id,
      source: { kind: 'local' as const },
      initialState: {},
      tabGroupId: 'leader',
    }))
    source.activeWindowId = 'third'
    source.activeTabMap = { leader: 'third' }
    const afterClose = closeWorkspaceWindows(source, new Set(['leader'])).state
    const destination = state('desktop')
    destination.windows = [
      {
        id: 'leader',
        type: 'browser',
        title: 'unrelated',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
      },
    ]

    const moved = transferWorkspaceGroups(afterClose, destination, { windowIds: ['second'] })

    expect(
      moved.destination.windows.find((window) => window.id === 'leader')?.tabGroupId,
    ).toBeNull()
    expect(
      moved.destination.windows
        .filter((window) => window.id !== 'leader')
        .map((window) => window.tabGroupId),
    ).toEqual(['second', 'second'])
    expect(moved.destination.activeTabMap).toEqual({ second: 'third' })
  })

  test('moves whole tab group and keeps it inside desktop viewport', () => {
    const source = state('canvas')
    source.windows = ['one', 'two'].map((id) => ({
      id,
      type: 'viewer' as const,
      title: id,
      source: { kind: 'local' as const },
      initialState: {},
      tabGroupId: 'one',
      layout: { bounds: { x: 5000, y: 5000, width: 640, height: 480 } },
    }))
    source.activeTabMap.one = 'two'
    const moved = transferWorkspaceGroups(source, state('desktop'), {
      windowIds: ['two'],
      viewport: { width: 800, height: 600 },
    })
    expect(moved.source.windows).toHaveLength(0)
    expect(moved.destination.windows).toHaveLength(2)
    expect(moved.destination.activeTabMap.one).toBe('two')
    for (const window of moved.destination.windows) {
      const bounds = window.layout!.bounds!
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(800)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(600)
    }
  })

  test('centers desktop groups in the destination canvas camera and preserves split metadata', () => {
    const source = state('desktop')
    source.windows = ['one', 'two'].map((id, index) => ({
      id,
      type: 'viewer' as const,
      title: id,
      source: { kind: 'local' as const },
      initialState: {},
      tabGroupId: 'one',
      layout: { bounds: { x: 100, y: 120, width: 500, height: 360 }, zIndex: index + 1 },
    }))
    source.activeTabMap.one = 'two'
    source.tabGroupSplits = { one: { leftTabId: 'one', leftPaneFraction: 0.4 } }
    const destination = state('canvas')
    destination.canvas!.camera = { x: -200, y: 100, zoom: 0.5 }
    const moved = transferWorkspaceGroups(source, destination, {
      windowIds: ['two'],
      viewport: { width: 1000, height: 700 },
    })
    const bounds = moved.destination.windows[0]!.layout!.bounds!
    expect(bounds.x + bounds.width / 2).toBe(1400)
    expect(bounds.y + bounds.height / 2).toBe(500)
    expect(moved.destination.activeTabMap.one).toBe('two')
    expect(moved.destination.tabGroupSplits?.one).toEqual({
      leftTabId: 'one',
      leftPaneFraction: 0.4,
    })
  })

  test('puts moved groups above existing windows and fully inside visible canvas', () => {
    const source = state('desktop')
    source.windows = [
      {
        id: 'moved',
        type: 'viewer',
        title: 'Moved',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
        layout: { bounds: { x: -5000, y: 9000, width: 2000, height: 1400 }, zIndex: 1 },
      },
    ]
    const destination = state('canvas')
    destination.windows = [
      {
        id: 'existing',
        type: 'browser',
        title: 'Existing',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
        layout: { bounds: { x: 0, y: 0, width: 400, height: 300 }, zIndex: 50 },
      },
    ]
    destination.canvas!.camera = { x: -200, y: 100, zoom: 0.5 }
    destination.canvas!.nextZIndex = 2

    const moved = transferWorkspaceGroups(source, destination, {
      windowIds: ['moved'],
      viewport: { width: 1000, height: 700 },
    })
    const window = moved.destination.windows.find((candidate) => candidate.id === 'moved')!
    const bounds = window.layout!.bounds!
    const camera = moved.destination.canvas!.camera

    expect(bounds.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(0)
    expect((bounds.x + bounds.width) * camera.zoom + camera.x).toBeLessThanOrEqual(1000)
    expect((bounds.y + bounds.height) * camera.zoom + camera.y).toBeLessThanOrEqual(700)
    expect(window.layout!.zIndex).toBeGreaterThan(50)
    expect(moved.destination.canvas!.nextZIndex).toBeGreaterThan(window.layout!.zIndex!)
  })

  test('puts moved desktop groups above existing high z-index windows', () => {
    const source = state('canvas')
    source.windows = [
      {
        id: 'moved',
        type: 'viewer',
        title: 'Moved',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
        layout: { bounds: { x: 0, y: 0, width: 640, height: 480 }, zIndex: 1 },
      },
    ]
    const destination = state('desktop')
    destination.windows = [
      {
        id: 'existing',
        type: 'browser',
        title: 'Existing',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
        layout: { bounds: { x: 0, y: 0, width: 640, height: 480 }, zIndex: 80 },
      },
    ]

    const moved = transferWorkspaceGroups(source, destination, {
      windowIds: ['moved'],
      viewport: { width: 1000, height: 700 },
    })
    expect(
      moved.destination.windows.find((window) => window.id === 'moved')!.layout!.zIndex,
    ).toBeGreaterThan(80)
  })

  test('clears file-open target references that do not move with the window', () => {
    const source = state('desktop')
    source.windows = [
      {
        id: 'browser',
        type: 'browser',
        title: 'Browser',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
        fileOpenTargetWindowId: 'viewer',
      },
      {
        id: 'viewer',
        type: 'viewer',
        title: 'Viewer',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
      },
    ]

    const moved = transferWorkspaceGroups(source, state('desktop'), {
      windowIds: ['browser'],
    })

    expect(moved.destination.windows[0]!.fileOpenTargetWindowId).toBeNull()
  })

  test('keeps desktop transfers fully inside a viewport smaller than normal minimums', () => {
    const source = state('canvas')
    source.windows = [
      {
        id: 'moved',
        type: 'viewer',
        title: 'Moved',
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
      },
    ]

    const viewport = { width: 280, height: 190 }
    const moved = transferWorkspaceGroups(source, state('desktop'), {
      windowIds: ['moved'],
      viewport,
    })
    const bounds = moved.destination.windows[0]!.layout!.bounds!

    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  })
})
