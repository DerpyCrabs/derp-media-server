import { describe, expect, test } from 'bun:test'
import {
  getResourceDragData,
  hasResourceDragData,
  isDirectoryResourceDragData,
  setResourceDragData,
  type ResourceDragData,
} from '@/lib/resource-drag-data'

function createMockDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  const types: string[] = []
  return {
    types,
    setData(type: string, data: string) {
      store.set(type, data)
      if (!types.includes(type)) types.push(type)
    },
    getData(type: string) {
      return store.get(type) ?? ''
    },
  } as unknown as DataTransfer
}

describe('resource drag data', () => {
  test('round-trips a canonical resource key', () => {
    const transfer = createMockDataTransfer()
    const data: ResourceDragData = {
      key: { provider: 'filesystem', id: 'v1:18:configured-defaultDocuments/readme.txt' },
      isDirectory: true,
    }
    setResourceDragData(transfer, data)
    expect(getResourceDragData(transfer)).toEqual(data)
    expect(hasResourceDragData(transfer)).toBe(true)
    expect(transfer.types).toContain('application/x-derp-resource-drag-directory')
    expect(isDirectoryResourceDragData(transfer)).toBe(true)
  })

  test('rejects malformed and legacy path payloads', () => {
    const transfer = createMockDataTransfer()
    transfer.setData(
      'application/x-derp-resource-drag',
      JSON.stringify({ path: 'Documents/readme.txt', isDirectory: false, sourceKind: 'local' }),
    )
    expect(hasResourceDragData(transfer)).toBe(true)
    expect(getResourceDragData(transfer)).toBeNull()
  })
})
