import { test, expect } from 'bun:test'
import {
  assertKbRelativePathSafe,
  canonicalKbRelativePath,
  kbRelativeToMediaPath,
  mediaPathToKbRelative,
  KbFsPathError,
} from '@/lib/kb-chat-fs-paths'

test('kbRelativeToMediaPath joins and normalizes', () => {
  expect(kbRelativeToMediaPath('Notes', '')).toBe('Notes')
  expect(kbRelativeToMediaPath('Notes', 'foo/bar.md')).toBe('Notes/foo/bar.md')
})

test('kbRelativeToMediaPath strips one mistaken KB prefix from model input', () => {
  expect(kbRelativeToMediaPath('Notes', 'Notes/Logs')).toBe('Notes/Logs')
  expect(kbRelativeToMediaPath('Vault', 'Vault/a/Vault/b')).toBe('Vault/a/Vault/b')
})

test('kbRelativeToMediaPath rejects traversal', () => {
  expect(() => kbRelativeToMediaPath('Notes', '../secret')).toThrow(KbFsPathError)
  expect(() => assertKbRelativePathSafe('a/../../b')).toThrow(KbFsPathError)
})

test('mediaPathToKbRelative strips KB root', () => {
  expect(mediaPathToKbRelative('Notes', 'Notes')).toBe('')
  expect(mediaPathToKbRelative('Notes', 'Notes/foo.md')).toBe('foo.md')
})

test('kbRelativeToMediaPath rejects invalid KB root', () => {
  expect(() => kbRelativeToMediaPath('', 'x')).toThrow(KbFsPathError)
})

test('canonicalKbRelativePath collapses repeated KB root segments in sloppy paths', () => {
  expect(canonicalKbRelativePath('Notes', 'Notes/Notes/Logs/x.md')).toBe('Logs/x.md')
  expect(canonicalKbRelativePath('Notes', 'Logs/x.md')).toBe('Logs/x.md')
})
