import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExplorerItem } from '../../src/features/explorer/types'
import {
  calculateExplorerGridColumns,
  EXPLORER_VIRTUALIZATION_THRESHOLD,
  explorerGridRowKey,
  explorerItemKey,
  explorerVisibleItemRange,
  shouldVirtualizeExplorerItems,
} from '../../src/features/explorer/virtualization'

function item(key: string): ExplorerItem {
  return {
    key,
    resource: {
      key: { provider: 'test', id: key },
      name: key,
      kind: 'file',
      capabilities: [],
    },
    actions: [],
    payload: undefined,
  }
}

describe('explorer virtualization helpers', () => {
  test('keeps the shared 100-item threshold', () => {
    expect(EXPLORER_VIRTUALIZATION_THRESHOLD).toBe(100)
    expect(shouldVirtualizeExplorerItems(100)).toBe(false)
    expect(shouldVirtualizeExplorerItems(101)).toBe(true)
  })

  test('derives stable list and grid keys from ExplorerItem.key', () => {
    const items = [item('alpha'), item('bravo'), item('charlie'), item('delta')]
    expect(explorerItemKey(items, 1)).toBe('bravo')
    expect(explorerGridRowKey(items, 1, 2)).toBe('charlie')
    expect(explorerItemKey([items[3], ...items.slice(0, 3)], 0)).toBe('delta')
  })

  test('maps virtual grid rows back to the visible item range', () => {
    expect(explorerVisibleItemRange([{ index: 2 }, { index: 3 }], 11, 3)).toEqual({
      startIndex: 6,
      endIndex: 10,
    })
    expect(explorerVisibleItemRange([], 11, 3)).toBeUndefined()
  })

  test('calculates responsive columns with a six-column ceiling', () => {
    expect(calculateExplorerGridColumns(0)).toBe(1)
    expect(calculateExplorerGridColumns(268)).toBe(2)
    expect(calculateExplorerGridColumns(2_000)).toBe(6)
  })
})

describe('ExplorerVirtualizedItems boundary', () => {
  const source = readFileSync(
    resolve(import.meta.dir, '../../src/features/explorer/ExplorerVirtualizedItems.tsx'),
    'utf8',
  )

  test('supports contained and window scroll targets and exposes pagination range updates', () => {
    expect(source).toContain('createVirtualizer<HTMLElement, HTMLElement>')
    expect(source).toContain('getScrollElement: () => props.getScrollElement() ?? null')
    expect(source).toContain('createWindowVirtualizer<HTMLElement>')
    expect(source).toContain("props.scrollMode === 'window'")
    expect(source).toContain('props.onVisibleRange')
  })

  test('provides table and file-browser-grid wrappers', () => {
    expect(source).toContain('<table')
    expect(source).toContain("'file-browser-grid gap-3 p-3'")
    expect(source).toContain('explorerItemKey(items, index)')
    expect(source).toContain('explorerGridRowKey(items, index, columnCount)')
  })
})
