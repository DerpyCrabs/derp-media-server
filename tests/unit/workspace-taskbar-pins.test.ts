import { describe, expect, test } from 'bun:test'
import {
  filterAdminWorkspaceTaskbarPins,
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

describe('workspace taskbar pins', () => {
  test('returns empty for non-array input', () => {
    expect(parseWorkspaceTaskbarPins(null)).toEqual([])
    expect(parseWorkspaceTaskbarPins({})).toEqual([])
  })

  test('parses local pins and rejects malformed sources', () => {
    expect(
      parseWorkspaceTaskbarPins([
        validLocal,
        { id: 'x', path: '/p', title: 't', source: { kind: 'remote' } },
        { id: 'y', path: '/p', isDirectory: true, title: 't', source: {} },
      ]),
    ).toEqual([validLocal])
  })

  test('filters unsafe local paths', () => {
    const bad: WorkspaceTaskbarPin = { ...validLocal, id: 'b', path: '/foo/../secret' }
    const empty: WorkspaceTaskbarPin = { ...validLocal, id: 'e', path: '' }
    expect(filterAdminWorkspaceTaskbarPins([validLocal, bad, empty])).toEqual([validLocal])
  })
})
