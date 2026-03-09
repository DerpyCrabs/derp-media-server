import { describe, expect, test } from 'bun:test'
import { isKnowledgeBaseImagePath, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'

describe('getKnowledgeBaseRootForPath', () => {
  test('returns null for empty knowledge bases', () => {
    expect(getKnowledgeBaseRootForPath('Notes/file.md', [])).toBeNull()
  })

  test('returns KB root when path matches exactly', () => {
    expect(getKnowledgeBaseRootForPath('Notes', ['Notes'])).toBe('Notes')
  })

  test('returns KB root when path is inside KB', () => {
    expect(getKnowledgeBaseRootForPath('Notes/subfolder/file.md', ['Notes'])).toBe('Notes')
  })

  test('returns null when path is outside all KBs', () => {
    expect(getKnowledgeBaseRootForPath('Documents/file.md', ['Notes'])).toBeNull()
  })

  test('normalizes backslashes', () => {
    expect(getKnowledgeBaseRootForPath('Notes\\subfolder', ['Notes'])).toBe('Notes')
  })

  test('does not match partial directory names', () => {
    expect(getKnowledgeBaseRootForPath('NotesExtra/file.md', ['Notes'])).toBeNull()
  })
})

describe('isKnowledgeBaseImagePath', () => {
  const kbs = ['Notes']

  test('returns true for valid image in KB images dir', () => {
    expect(isKnowledgeBaseImagePath('Notes/images/diagram.png', 'Notes', kbs)).toBe(true)
  })

  test('returns false for path with .. traversal', () => {
    expect(isKnowledgeBaseImagePath('Notes/images/../../../etc/passwd', 'Notes', kbs)).toBe(false)
  })

  test('returns false for .. anywhere in path', () => {
    expect(isKnowledgeBaseImagePath('../Notes/images/diagram.png', 'Notes', kbs)).toBe(false)
  })

  test('returns false for empty relative path (just the images dir)', () => {
    expect(isKnowledgeBaseImagePath('Notes/images/', 'Notes', kbs)).toBe(false)
  })

  test('returns false for nested subdirectory in images', () => {
    expect(isKnowledgeBaseImagePath('Notes/images/sub/diagram.png', 'Notes', kbs)).toBe(false)
  })

  test('returns false for path outside images dir', () => {
    expect(isKnowledgeBaseImagePath('Notes/welcome.md', 'Notes', kbs)).toBe(false)
  })

  test('returns false when share path is not a KB', () => {
    expect(isKnowledgeBaseImagePath('Documents/images/pic.png', 'Documents', kbs)).toBe(false)
  })

  test('returns false for backslash traversal', () => {
    expect(isKnowledgeBaseImagePath('Notes\\images\\..\\secret.txt', 'Notes', kbs)).toBe(false)
  })
})
