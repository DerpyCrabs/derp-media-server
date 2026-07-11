import { describe, expect, test } from 'bun:test'
import { normalizeMediaRoots } from '@/lib/config'
import { isPathEditable } from '@/lib/utils'

describe('normalizeMediaRoots', () => {
  test('keeps legacy mediaDir as a single root', () => {
    expect(normalizeMediaRoots('test-media', ['Notes'])).toEqual([
      {
        id: 'config:primary',
        name: 'test-media',
        path: 'test-media',
        editableFolders: ['Notes'],
        readOnly: false,
        source: 'config',
      },
    ])
  })

  test('derives names from mediaDirs paths', () => {
    expect(
      normalizeMediaRoots(
        'ignored',
        [],
        [
          { path: '/srv/media/movies', editableFolders: ['Incoming'] },
          { path: '/srv/media/shows', editableFolders: ['Downloads'] },
        ],
      ).map((root) => root.name),
    ).toEqual(['movies', 'shows'])
  })

  test('requires unique names when derived names collide', () => {
    expect(() =>
      normalizeMediaRoots('ignored', [], [{ path: '/srv/a/media' }, { path: '/srv/b/media' }]),
    ).toThrow(/Duplicate mediaDirs name/)
  })

  test('allows explicit names to disambiguate duplicate basenames', () => {
    expect(
      normalizeMediaRoots(
        'ignored',
        [],
        [
          { path: '/srv/a/media', name: 'Movies' },
          { path: '/srv/b/media', name: 'Shows' },
        ],
      ).map((root) => root.name),
    ).toEqual(['Movies', 'Shows'])
  })

  test('rejects virtual folder names', () => {
    expect(() =>
      normalizeMediaRoots('ignored', [], [{ path: '/srv/media', name: 'Shares' }]),
    ).toThrow(/conflicts with a virtual folder/)
  })
})

describe('root-aware editability', () => {
  test('checks editable folders within the selected media root', () => {
    expect(
      isPathEditable(
        'Movies/Incoming/new.txt',
        ['Movies/Incoming'],
        [
          { name: 'Movies', editableFolders: ['Incoming'] },
          { name: 'Shows', editableFolders: ['Downloads'] },
        ],
      ),
    ).toBe(true)

    expect(
      isPathEditable(
        'Shows/Incoming/new.txt',
        ['Movies/Incoming'],
        [
          { name: 'Movies', editableFolders: ['Incoming'] },
          { name: 'Shows', editableFolders: ['Downloads'] },
        ],
      ),
    ).toBe(false)
  })
})
