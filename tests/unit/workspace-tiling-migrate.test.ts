import { describe, expect, test } from 'bun:test'
import { applyAssistCustomSnapToWindows } from '@/lib/workspace-assist-grid'
import { normalizePersistedWorkspaceState } from '@/lib/use-workspace'
import { MediaType } from '@/lib/types'
import { migrateLegacyAssistCustomToTiling } from '@/lib/workspace-tiling-migrate'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'

/** Bounds from the saved "Obsidian" admin preset (assist-custom, no tiling). */
function obsidianLegacyWindows(): WorkspaceWindowDefinition[] {
  const mk = (
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
    tabGroupId: string | null = null,
  ): WorkspaceWindowDefinition => ({
    id,
    type: 'browser',
    title: id,
    iconType: MediaType.FOLDER,
    source: { kind: 'local' },
    initialState: {},
    tabGroupId,
    layout: {
      bounds,
      snapZone: 'assist-custom',
      fullscreen: false,
      minimized: false,
      zIndex: 1,
    },
  })
  return [
    mk('left', { x: 0, y: 0, width: 480, height: 1608 }),
    mk('top-span', { x: 480, y: 0, width: 960, height: 804 }, 'g-top'),
    mk('mid-left', { x: 480, y: 804, width: 480, height: 804 }, 'g-mid'),
    mk('mid-right', { x: 960, y: 804, width: 480, height: 804 }, 'g-right'),
    mk('bot-left', { x: 0, y: 1607, width: 480, height: 804 }),
    mk('bot-span', { x: 480, y: 1607, width: 960, height: 804 }),
  ]
}

describe('migrateLegacyAssistCustomToTiling', () => {
  test('recovers a 3×3 grid from Obsidian-like assist-custom bounds', () => {
    const next = migrateLegacyAssistCustomToTiling(obsidianLegacyWindows())
    for (const w of next) {
      expect(w.layout?.snapZone).toBeNull()
      expect(w.layout?.tiling).toBeTruthy()
      expect(w.layout!.tiling!.cols).toBe(3)
      expect(w.layout!.tiling!.rows).toBe(3)
    }
    const lines = next[0]!.layout!.tiling!.colLines
    for (const w of next) {
      expect(w.layout!.tiling!.colLines).toEqual(lines)
    }
  })

  test('normalizePersistedWorkspaceState migrates assist-custom presets', () => {
    const normalized = normalizePersistedWorkspaceState({
      windows: obsidianLegacyWindows(),
      activeWindowId: 'left',
      activeTabMap: {},
      nextWindowId: 10,
    })
    expect(normalized).toBeTruthy()
    expect(normalized!.windows.every((w) => w.layout?.snapZone !== 'assist-custom')).toBe(true)
    expect(normalized!.windows.every((w) => w.layout?.tiling?.cols === 3)).toBe(true)
  })

  test('snapping into migrated 3×3 grid abuts the shared column edge', () => {
    const migrated = migrateLegacyAssistCustomToTiling(obsidianLegacyWindows(), {
      width: 1440,
      height: 2411,
    })
    const floating: WorkspaceWindowDefinition = {
      id: 'new',
      type: 'browser',
      title: 'new',
      iconType: MediaType.FOLDER,
      source: { kind: 'local' },
      initialState: {},
      layout: { bounds: { x: 20, y: 20, width: 400, height: 300 } },
    }
    const next = applyAssistCustomSnapToWindows(
      [...migrated, floating],
      'new',
      { gridCols: 3, gridRows: 3, gc0: 1, gc1: 1, gr0: 0, gr1: 0 },
      { width: 1440, height: 2411 },
    )
    const left = next.find((w) => w.id === 'left')!.layout!.bounds!
    const placed = next.find((w) => w.id === 'new')!.layout!.bounds!
    expect(placed.x).toBe(left.x + left.width)
    expect(next.find((w) => w.id === 'new')!.layout!.snapZone).toBeNull()
    expect(next.find((w) => w.id === 'new')!.layout!.tiling!.cols).toBe(3)
  })
})
