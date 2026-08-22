import { describe, expect, test } from 'bun:test'
import { createCrossWorkspaceTransferController } from '@/workspace/shared/cross-workspace-transfer-controller'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'

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
  test('rolls back gesture after the session rejects a move', async () => {
    const before = workspace('source-window')
    let current = structuredClone(before)
    const destination = workspace('destination-window')
    const transfers: string[] = []
    const navigated: string[] = []
    const controller = createCrossWorkspaceTransferController({
      sourceId: () => 'source',
      session: {
        state: { editable: () => true },
        document: {
          value: () => current,
          update: (value) => {
            current = typeof value === 'function' ? (value(current) ?? current) : (value ?? current)
            return current
          },
        },
        transfer: {
          windows: async (input) => {
            transfers.push(input.destinationId)
            return {
              kind: 'failed' as const,
              rollback: true,
              message: 'Workspace changed on server',
            }
          },
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
    expect(transfers).toEqual(['destination'])
    expect(navigated).toEqual(['source'])
    expect(current.windows[0]!.layout!.bounds!.x).toBe(0)
  })
})
