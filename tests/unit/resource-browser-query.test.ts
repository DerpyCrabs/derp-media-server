import { describe, expect, test } from 'bun:test'
import { ownerResourceBrowserQuery } from '@/src/workspace/resource-browser-query'

describe('Workspace/Canvas Resource browser query', () => {
  test('scopes transport and cache identity to current surface', () => {
    expect(ownerResourceBrowserQuery('Hermes Sessions', 20, 'workspace')).toEqual({
      queryKey: ['files', 'Hermes Sessions', 'surface', 'workspace', 20],
      url: '/api/files?surface=workspace&dir=Hermes%20Sessions&offset=20',
    })
    expect(ownerResourceBrowserQuery('', 0, 'canvas')).toEqual({
      queryKey: ['files', '', 'surface', 'canvas', 0],
      url: '/api/files?surface=canvas&dir=&offset=0',
    })
  })
})
