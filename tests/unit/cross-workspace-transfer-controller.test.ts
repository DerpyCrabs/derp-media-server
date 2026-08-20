import { describe, expect, test } from 'bun:test'
import { ApiError } from '@/lib/api/client'
import { createCrossWorkspaceTransferController } from '@/workspace/shared/cross-workspace-transfer-controller'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type { WorkspaceRegistry } from '@/workspace/model/workspace-registry'

function workspace(id: string, x = 0): PersistedWorkspaceState {
  return {
    workspaceType: 'desktop',
    windows: [
      {
        id,
        type: 'browser',
        title: id,
        source: { kind: 'local' },
        initialState: {},
        tabGroupId: null,
        layout: { bounds: { x, y: 0, width: 640, height: 480 }, zIndex: 1 },
      },
    ],
    activeWindowId: id,
    activeTabMap: {},
    nextWindowId: 2,
  }
}

describe('cross-workspace transfer controller', () => {
  test('releases destination and rolls back gesture after rejected move', async () => {
    const before = workspace('source-window')
    let current = structuredClone(before)
    const destination = workspace('destination-window')
    const registry: WorkspaceRegistry = {
      version: 1,
      order: ['source', 'destination'],
      records: {
        source: {
          id: 'source',
          snapshot: before,
          revision: 3,
          updatedAt: 0,
          lastOpenedAt: 0,
        },
        destination: {
          id: 'destination',
          snapshot: destination,
          revision: 5,
          updatedAt: 0,
          lastOpenedAt: 0,
        },
      },
    }
    const released: string[] = []
    const navigated: string[] = []
    const controller = createCrossWorkspaceTransferController({
      sourceId: () => 'source',
      session: {
        document: () => current,
        editable: () => true,
        revision: () => 3,
        registry: () => registry,
        flush: async () => {},
        acquire: async () => ({ editable: true, record: registry.records.destination! }),
        release: async (id) => {
          released.push(id)
        },
        deleteWorkspace: async () => {},
        moveWorkspaces: async () => {
          throw new ApiError(409, 'Workspace changed on server')
        },
        update: (value) => {
          current = typeof value === 'function' ? (value(current) ?? current) : (value ?? current)
          return current
        },
      },
      emptyDestination: () => destination,
      navigate: (id) => navigated.push(id),
      viewport: () => ({ width: 1280, height: 720 }),
      rollbackGesture: (_latest, original) => structuredClone(original),
    })

    expect(controller.begin(['source-window'])).toBe(true)
    current.windows[0]!.layout!.bounds!.x = 400
    controller.hover('destination')

    expect(await controller.drop('destination')).toBe(false)
    expect(released).toEqual(['destination'])
    expect(navigated).toEqual(['source'])
    expect(current.windows[0]!.layout!.bounds!.x).toBe(0)
  })
})
