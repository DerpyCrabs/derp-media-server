import { describe, expect, test } from 'bun:test'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'

describe('normalizeNewFilePath', () => {
  test('always creates Markdown notes inside knowledge bases', () => {
    expect(normalizeNewFilePath('Notes/2026.08.08', true)).toBe('Notes/2026.08.08.md')
    expect(normalizeNewFilePath('Notes/note.txt', true)).toBe('Notes/note.txt.md')
    expect(normalizeNewFilePath('Notes/already.MD', true)).toBe('Notes/already.MD')
  })

  test('checks only file name outside knowledge bases', () => {
    expect(normalizeNewFilePath('folder.with.dots/note', false)).toBe('folder.with.dots/note.txt')
    expect(normalizeNewFilePath('folder.with.dots/note.json', false)).toBe(
      'folder.with.dots/note.json',
    )
  })
})
