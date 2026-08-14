import { describe, expect, test } from 'bun:test'
import {
  setFileDragData,
  getFileDragData,
  hasFileDragData,
  isCompatibleSource,
  type FileDragData,
} from '@/lib/file-drag-data'

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

describe('file drag data', () => {
  test('round-trips local file data', () => {
    const dt = createMockDataTransfer()
    const data: FileDragData = {
      path: 'Documents/readme.txt',
      isDirectory: false,
      sourceKind: 'local',
    }
    setFileDragData(dt, data)
    expect(getFileDragData(dt)).toEqual(data)
    expect(dt.getData('text/plain')).toBe('Documents/readme.txt')
  })

  test('round-trips virtual open targets', () => {
    const dt = createMockDataTransfer()
    const data: FileDragData = {
      path: 'opaque-provider-entry',
      isDirectory: false,
      sourceKind: 'local',
      isVirtual: true,
      virtualOpenTarget: { type: 'hermesSession', sessionId: 'durable-1', readOnly: false },
    }
    setFileDragData(dt, data)
    expect(getFileDragData(dt)).toEqual(data)
  })

  test('reports custom drag data and rejects malformed payloads', () => {
    const dt = createMockDataTransfer()
    expect(hasFileDragData(dt)).toBe(false)
    dt.setData('application/x-derp-file-drag', JSON.stringify({ isDirectory: true }))
    expect(hasFileDragData(dt)).toBe(true)
    expect(getFileDragData(dt)).toBeNull()

    const malformedVirtualFlag = createMockDataTransfer()
    malformedVirtualFlag.setData(
      'application/x-derp-file-drag',
      JSON.stringify({ path: 'virtual', isDirectory: true, isVirtual: 'yes' }),
    )
    expect(getFileDragData(malformedVirtualFlag)).toBeNull()
  })

  test('matches local sources', () => {
    expect(
      isCompatibleSource(
        { sourceKind: 'local' },
        { path: 'a', isDirectory: false, sourceKind: 'local' },
      ),
    ).toBe(true)
  })
})
