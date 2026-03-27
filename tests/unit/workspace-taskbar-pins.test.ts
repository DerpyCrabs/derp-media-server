import { describe, expect, test } from 'bun:test'
import {
  filterAdminWorkspaceTaskbarPins,
  filterShareWorkspaceTaskbarPins,
  parseWorkspaceTaskbarPins,
  type WorkspaceTaskbarPin,
} from '@/lib/workspace-taskbar-pins'

const validLocal: WorkspaceTaskbarPin = {
  id: '1',
  path: '/Docs',
  isDirectory: true,
  title: 'Docs',
  source: { kind: 'local' },
}

const validShare: WorkspaceTaskbarPin = {
  id: '2',
  path: '/Shared/Media',
  isDirectory: false,
  title: 'Media',
  source: { kind: 'share', token: 'tok' },
}

describe('parseWorkspaceTaskbarPins', () => {
  test('returns empty for non-array', () => {
    expect(parseWorkspaceTaskbarPins(null)).toEqual([])
    expect(parseWorkspaceTaskbarPins({})).toEqual([])
  })

  test('filters out invalid pins', () => {
    const parsed = parseWorkspaceTaskbarPins([
      validLocal,
      { id: 'x', path: '/p', title: 't', source: { kind: 'share' } },
      { id: 'y', path: '/p', isDirectory: true, title: 't', source: {} },
    ])
    expect(parsed).toEqual([validLocal])
  })

  test('accepts valid share pin with token', () => {
    expect(parseWorkspaceTaskbarPins([validShare])).toEqual([validShare])
  })
})

describe('filterAdminWorkspaceTaskbarPins', () => {
  test('keeps local safe paths only', () => {
    const pins = parseWorkspaceTaskbarPins([validLocal, validShare])
    expect(filterAdminWorkspaceTaskbarPins(pins)).toEqual([validLocal])
  })

  test('drops paths with parent segments', () => {
    const bad: WorkspaceTaskbarPin = {
      ...validLocal,
      id: 'b',
      path: '/foo/../secret',
    }
    expect(filterAdminWorkspaceTaskbarPins([validLocal, bad])).toEqual([validLocal])
  })

  test('drops empty path', () => {
    const empty: WorkspaceTaskbarPin = { ...validLocal, id: 'e', path: '' }
    expect(filterAdminWorkspaceTaskbarPins([empty])).toEqual([])
  })
})

describe('filterShareWorkspaceTaskbarPins', () => {
  const shareRoot = '/SharedContent'

  test('keeps share pins for matching token under root', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 's',
      path: '/SharedContent/Notes',
      isDirectory: true,
      title: 'Notes',
      source: { kind: 'share', token: 'abc' },
    }
    expect(filterShareWorkspaceTaskbarPins(shareRoot, 'abc', [pin])).toEqual([pin])
  })

  test('allows path equal to root', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 'r',
      path: '/SharedContent',
      isDirectory: true,
      title: 'Root',
      source: { kind: 'share', token: 'abc' },
    }
    expect(filterShareWorkspaceTaskbarPins(shareRoot, 'abc', [pin])).toEqual([pin])
  })

  test('rejects wrong token or path outside root', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 's',
      path: '/SharedContent/x',
      isDirectory: false,
      title: 'x',
      source: { kind: 'share', token: 'other' },
    }
    expect(filterShareWorkspaceTaskbarPins(shareRoot, 'abc', [pin])).toEqual([])
    const escape: WorkspaceTaskbarPin = {
      ...pin,
      id: 'e',
      source: { kind: 'share', token: 'abc' },
      path: '/OtherRoot/file',
    }
    expect(filterShareWorkspaceTaskbarPins(shareRoot, 'abc', [escape])).toEqual([])
  })

  test('rejects dot-dot in path', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 'd',
      path: '/SharedContent/../etc',
      isDirectory: false,
      title: 'bad',
      source: { kind: 'share', token: 'abc' },
    }
    expect(filterShareWorkspaceTaskbarPins(shareRoot, 'abc', [pin])).toEqual([])
  })

  test('normalizes backslashes', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 'w',
      path: '\\SharedContent\\sub',
      isDirectory: false,
      title: 'sub',
      source: { kind: 'share', token: 'abc' },
    }
    expect(filterShareWorkspaceTaskbarPins(shareRoot, 'abc', [pin])).toEqual([pin])
  })
})
