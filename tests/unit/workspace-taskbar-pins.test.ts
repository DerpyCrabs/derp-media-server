import { describe, expect, test } from 'bun:test'
import { parseTaskbarPins, type TaskbarPin } from '@/lib/models/taskbar-pins'
import { filterAdminTaskbarPins } from '@/workspace/model/workspace-taskbar-pins'

const validLocal: TaskbarPin = {
  id: '1',
  path: '/Docs',
  isDirectory: true,
  title: 'Docs',
  source: { kind: 'local' },
}

describe('workspace taskbar pins', () => {
  test('returns empty for non-array input', () => {
    expect(parseTaskbarPins(null)).toEqual([])
    expect(parseTaskbarPins({})).toEqual([])
  })

  test('parses local pins and rejects malformed sources', () => {
    expect(
      parseTaskbarPins([
        validLocal,
        { id: 'x', path: '/p', title: 't', source: { kind: 'remote' } },
        { id: 'y', path: '/p', isDirectory: true, title: 't', source: {} },
      ]),
    ).toEqual([validLocal])
  })

  test('filters unsafe local paths', () => {
    const bad: TaskbarPin = { ...validLocal, id: 'b', path: '/foo/../secret' }
    const empty: TaskbarPin = { ...validLocal, id: 'e', path: '' }
    expect(filterAdminTaskbarPins([validLocal, bad, empty])).toEqual([validLocal])
  })
})
