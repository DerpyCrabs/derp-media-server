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
      if (!types.includes(type)) {
        types.push(type)
      }
    },
    getData(type: string) {
      return store.get(type) ?? ''
    },
  } as unknown as DataTransfer
}

describe('setFileDragData / getFileDragData', () => {
  test('round-trips local file data', () => {
    const dt = createMockDataTransfer()
    const data: FileDragData = {
      path: 'Documents/readme.txt',
      isDirectory: false,
      sourceKind: 'local',
    }
    setFileDragData(dt, data)

    const result = getFileDragData(dt)
    expect(result).toEqual(data)
  })

  test('round-trips share directory data', () => {
    const dt = createMockDataTransfer()
    const data: FileDragData = {
      path: 'SharedContent/subfolder',
      isDirectory: true,
      sourceKind: 'share',
      sourceToken: 'abc123',
    }
    setFileDragData(dt, data)

    const result = getFileDragData(dt)
    expect(result).toEqual(data)
  })

  test('sets text/plain with the file path', () => {
    const dt = createMockDataTransfer()
    setFileDragData(dt, {
      path: 'Videos/sample.mp4',
      isDirectory: false,
      sourceKind: 'local',
    })

    expect(dt.getData('text/plain')).toBe('Videos/sample.mp4')
  })
})

describe('hasFileDragData', () => {
  test('returns true when custom MIME is present', () => {
    const dt = createMockDataTransfer()
    setFileDragData(dt, {
      path: 'test.txt',
      isDirectory: false,
      sourceKind: 'local',
    })
    expect(hasFileDragData(dt)).toBe(true)
  })

  test('returns false on empty DataTransfer', () => {
    const dt = createMockDataTransfer()
    expect(hasFileDragData(dt)).toBe(false)
  })

  test('returns false when only text/plain is set', () => {
    const dt = createMockDataTransfer()
    dt.setData('text/plain', 'some path')
    expect(hasFileDragData(dt)).toBe(false)
  })
})

describe('getFileDragData', () => {
  test('returns null on empty DataTransfer', () => {
    const dt = createMockDataTransfer()
    expect(getFileDragData(dt)).toBeNull()
  })

  test('returns null on malformed JSON', () => {
    const dt = createMockDataTransfer()
    dt.setData('application/x-derp-file-drag', 'not json')
    expect(getFileDragData(dt)).toBeNull()
  })

  test('returns null when path is missing', () => {
    const dt = createMockDataTransfer()
    dt.setData('application/x-derp-file-drag', JSON.stringify({ isDirectory: true }))
    expect(getFileDragData(dt)).toBeNull()
  })

  test('returns null when isDirectory is missing', () => {
    const dt = createMockDataTransfer()
    dt.setData(
      'application/x-derp-file-drag',
      JSON.stringify({ path: 'test', sourceKind: 'local' }),
    )
    expect(getFileDragData(dt)).toBeNull()
  })
})

describe('isCompatibleSource', () => {
  test('local-to-local is compatible', () => {
    expect(
      isCompatibleSource(
        { sourceKind: 'local' },
        { path: 'a', isDirectory: false, sourceKind: 'local' },
      ),
    ).toBe(true)
  })

  test('share-to-share with same token is compatible', () => {
    expect(
      isCompatibleSource(
        { sourceKind: 'share', sourceToken: 'tok1' },
        { path: 'a', isDirectory: false, sourceKind: 'share', sourceToken: 'tok1' },
      ),
    ).toBe(true)
  })

  test('share-to-share with different token is not compatible', () => {
    expect(
      isCompatibleSource(
        { sourceKind: 'share', sourceToken: 'tok1' },
        { path: 'a', isDirectory: false, sourceKind: 'share', sourceToken: 'tok2' },
      ),
    ).toBe(false)
  })

  test('local-to-share is not compatible', () => {
    expect(
      isCompatibleSource(
        { sourceKind: 'local' },
        { path: 'a', isDirectory: false, sourceKind: 'share', sourceToken: 'tok1' },
      ),
    ).toBe(false)
  })

  test('share-to-local is not compatible', () => {
    expect(
      isCompatibleSource(
        { sourceKind: 'share', sourceToken: 'tok1' },
        { path: 'a', isDirectory: false, sourceKind: 'local' },
      ),
    ).toBe(false)
  })
})
