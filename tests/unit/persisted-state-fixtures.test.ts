import { describe, expect, test } from 'bun:test'
import '@/src/integrations/current-window-content'
import {
  createDefaultCanvasCollection,
  parseCanvasCollection,
  serializeCanvasCollection,
} from '@/lib/canvas-persistence'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
} from '@/lib/use-workspace'
import { filesystemResourceAddress } from '@/lib/domain/resource'

const currentExplorerContent = {
  schemaVersion: 1 as const,
  codec: 'filesystem.content',
  codecVersion: 1,
  payload: {
    kind: 'explorer',
    id: 'current-browser',
    address: { rootId: 'configured-default', path: 'Notes' },
  },
}

describe('current persisted content schema', () => {
  test('restores and writes only authoritative workspace content envelopes', () => {
    const futureContent = {
      schemaVersion: 1 as const,
      codec: 'future.content',
      codecVersion: 9,
      payload: { opaque: true },
    }
    const raw = {
      windows: [
        {
          id: 'current-browser',
          title: 'Notes',
          content: currentExplorerContent,
          layout: { bounds: { x: 0, y: 0, width: 480, height: 320 } },
        },
        {
          id: 'future-pane',
          title: 'Future pane',
          content: futureContent,
          layout: { bounds: { x: 480, y: 0, width: 480, height: 320 } },
        },
      ],
      activeWindowId: 'future-pane',
      activeTabMap: {},
      nextWindowId: 3,
      pinnedTaskbarItems: [],
    }

    const restored = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(restored?.windows).toHaveLength(2)
    const content = restored?.windows[0]?.contentInstance
    expect(content?.type).toBe('explorer')
    expect(
      content?.type === 'explorer' ? filesystemResourceAddress(content.location)?.path : null,
    ).toBe('Notes')
    expect(restored?.windows[1]).toMatchObject({
      id: 'future-pane',
      contentRecoveryReason: 'Unknown content codec: future.content',
    })
    const encoded = JSON.parse(serializeWorkspacePersistedState(restored!)) as {
      windows: Record<string, unknown>[]
    }
    expect(encoded.windows.every((window) => 'content' in window)).toBe(true)
    expect(encoded.windows.every((window) => !('type' in window))).toBe(true)
    expect(encoded.windows.every((window) => !('source' in window))).toBe(true)
    expect(encoded.windows.every((window) => !('initialState' in window))).toBe(true)
  })

  test('round-trips current Canvas v2 document with content envelope', () => {
    const document = createDefaultCanvasCollection()
    document.canvases[0]!.state.windows = [
      {
        id: 'current-browser',
        definition: {
          id: 'current-browser',
          title: 'Notes',
          content: currentExplorerContent,
        },
        bounds: { x: 0, y: 0, width: 480, height: 320 },
        zIndex: 1,
      },
    ]
    const encoded = serializeCanvasCollection(document)
    const parsed = parseCanvasCollection(JSON.parse(encoded))
    expect(parsed).not.toBeNull()
    const normalized = serializeCanvasCollection(parsed!)
    expect(serializeCanvasCollection(parseCanvasCollection(JSON.parse(normalized))!)).toBe(
      normalized,
    )
    const definition = JSON.parse(encoded).canvases[0].state.windows[0].definition as Record<
      string,
      unknown
    >
    expect(definition.content).toEqual(currentExplorerContent)
    expect(definition).not.toHaveProperty('initialState')
  })

  test('rejects windows that mix authoritative content with projection fields', () => {
    const mixed = {
      windows: [
        {
          id: 'current-browser',
          title: 'Notes',
          content: currentExplorerContent,
          type: 'browser',
          source: { kind: 'local' },
          initialState: { dir: 'Notes' },
        },
      ],
      activeWindowId: 'current-browser',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    expect(normalizePersistedWorkspaceState(mixed)).toBeNull()
  })
})
