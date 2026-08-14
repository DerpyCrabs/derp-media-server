import { describe, expect, test } from 'bun:test'
import { parseWorkspaceTaskbarPins, type WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'

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
})
