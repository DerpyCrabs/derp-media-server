import { describe, expect, test } from 'bun:test'
import {
  TAB_DROP_BEFORE_FRACTION,
  insertIndexFromTabBodyPointer,
} from '@/src/workspace/tab-drop-hit'

describe('insertIndexFromTabBodyPointer', () => {
  test('inserts before tab when pointer is in left fraction of tab width', () => {
    const tabLeft = 100
    const tabWidth = 100
    const cutoff = tabLeft + TAB_DROP_BEFORE_FRACTION * tabWidth
    expect(insertIndexFromTabBodyPointer(cutoff - 1, tabLeft, tabWidth, 2)).toBe(2)
  })

  test('inserts after tab when pointer is in right portion', () => {
    const tabLeft = 100
    const tabWidth = 100
    const cutoff = tabLeft + TAB_DROP_BEFORE_FRACTION * tabWidth
    expect(insertIndexFromTabBodyPointer(cutoff + 1, tabLeft, tabWidth, 2)).toBe(3)
  })

  test('non-positive tab width falls back to after tab', () => {
    expect(insertIndexFromTabBodyPointer(0, 0, 0, 1)).toBe(2)
    expect(insertIndexFromTabBodyPointer(5, 10, -1, 0)).toBe(1)
  })
})
