import { describe, expect, test } from 'bun:test'
import { spaceCommandsToMatch } from '@/lib/space-sync'
import type { Space } from '@/lib/space'

function space(overrides: Partial<Space> = {}): Space {
  return {
    schemaVersion: 1,
    id: 'space-1',
    name: 'Desk',
    revision: 2,
    origin: 'canvas',
    panes: {
      one: { kind: 'browser', state: { title: 'Library' } },
    },
    arrangements: {
      spatial: {
        placements: { one: { bounds: { x: 0, y: 0, width: 320, height: 224 }, zIndex: 1 } },
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('Space presenter reconciliation', () => {
  test('emits typed pane and arrangement commands without replacing whole Space', () => {
    const desired = space({
      name: 'Renamed',
      panes: {
        one: { kind: 'viewer', state: { title: 'Document' } },
        two: { kind: 'assistant', state: { title: 'Chat' } },
      },
      arrangements: {
        spatial: {
          placements: { two: { bounds: { x: 32, y: 32, width: 640, height: 480 }, zIndex: 2 } },
        },
      },
    })

    expect(spaceCommandsToMatch(space(), desired)).toEqual([
      { type: 'rename', name: 'Renamed' },
      { type: 'removePane', paneId: 'one' },
      { type: 'addPane', paneId: 'one', pane: desired.panes.one },
      { type: 'addPane', paneId: 'two', pane: desired.panes.two },
      {
        type: 'applyArrangement',
        presentation: 'spatial',
        arrangement: desired.arrangements.spatial!,
      },
    ])
  })

  test('ignores revision and timestamps', () => {
    expect(spaceCommandsToMatch(space(), space({ revision: 99, updatedAt: 2 }))).toEqual([])
  })

  test('ignores JSON object key order after a server round trip', () => {
    const current = space({
      panes: {
        one: { kind: 'browser', state: { initialState: { dir: 'Documents' }, title: 'Library' } },
      },
    })
    const desired = space({
      panes: {
        one: { kind: 'browser', state: { title: 'Library', initialState: { dir: 'Documents' } } },
      },
    })
    expect(spaceCommandsToMatch(current, desired)).toEqual([])
  })

  test('clears arrangements missing from desired Space', () => {
    const current = space({
      arrangements: {
        tiled: { placements: {} },
        spatial: { placements: {} },
      },
    })
    const desired = space({ arrangements: { spatial: { placements: {} } } })

    expect(spaceCommandsToMatch(current, desired)).toEqual([
      { type: 'applyArrangement', presentation: 'tiled', arrangement: null },
    ])
  })

  test('treats prototype-named Pane IDs as opaque own properties', () => {
    const current = space({
      panes: Object.assign(Object.create(null), {
        toString: { kind: 'browser', state: { title: 'old' } },
      }),
      arrangements: {},
    })
    const desired = space({
      panes: Object.assign(Object.create(null), {
        constructor: { kind: 'viewer', state: { title: 'new' } },
      }),
      arrangements: {},
    })

    expect(spaceCommandsToMatch(current, desired)).toEqual([
      { type: 'removePane', paneId: 'toString' },
      {
        type: 'addPane',
        paneId: 'constructor',
        pane: { kind: 'viewer', state: { title: 'new' } },
      },
    ])
  })
})
