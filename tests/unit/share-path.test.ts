import { describe, expect, test } from 'bun:test'
import { resolveShareSubPath, type ShareLink } from '@/lib/shares'

function makeShare(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    token: 'test-token',
    path: 'SharedContent',
    isDirectory: true,
    editable: false,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('resolveShareSubPath', () => {
  describe('directory shares', () => {
    const share = makeShare()

    test('empty subPath returns share root', () => {
      expect(resolveShareSubPath(share, '')).toBe('SharedContent')
    })

    test('"." returns share root', () => {
      expect(resolveShareSubPath(share, '.')).toBe('SharedContent')
    })

    test('valid subfolder resolves correctly', () => {
      expect(resolveShareSubPath(share, 'subfolder')).toBe('SharedContent/subfolder')
    })

    test('nested subfolder resolves correctly', () => {
      expect(resolveShareSubPath(share, 'sub/deep/file.txt')).toBe(
        'SharedContent/sub/deep/file.txt',
      )
    })

    test('rejects .. traversal', () => {
      expect(resolveShareSubPath(share, '..')).toBeNull()
    })

    test('rejects .. in middle of path', () => {
      expect(resolveShareSubPath(share, 'subfolder/../../etc')).toBeNull()
    })

    test('rejects path starting with ../', () => {
      expect(resolveShareSubPath(share, '../outside')).toBeNull()
    })

    test('normalizes backslashes and rejects traversal', () => {
      expect(resolveShareSubPath(share, '..\\outside')).toBeNull()
    })

    test('rejects embedded .. segment', () => {
      expect(resolveShareSubPath(share, 'a/../../../etc/passwd')).toBeNull()
    })
  })

  describe('file shares', () => {
    const share = makeShare({ path: 'Documents/readme.txt', isDirectory: false })

    test('empty subPath returns file path', () => {
      expect(resolveShareSubPath(share, '')).toBe('Documents/readme.txt')
    })

    test('"." returns file path', () => {
      expect(resolveShareSubPath(share, '.')).toBe('Documents/readme.txt')
    })

    test('rejects any subPath navigation for file shares', () => {
      expect(resolveShareSubPath(share, 'other.txt')).toBeNull()
    })

    test('rejects traversal for file shares', () => {
      expect(resolveShareSubPath(share, '..')).toBeNull()
    })
  })
})
