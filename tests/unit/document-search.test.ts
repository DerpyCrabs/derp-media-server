import { expect, test } from 'bun:test'
import { findDocumentMatches } from '@/features/reader/document-search'
test('document search treats punctuation literally and preserves source offsets', () => {
  expect(
    findDocumentMatches('Before [test]. After [TEST].', '[test].', 3).map(({ page, from, to }) => ({
      page,
      from,
      to,
    })),
  ).toEqual([
    { page: 3, from: 7, to: 14 },
    { page: 3, from: 21, to: 28 },
  ])
})
test('document search handles Unicode without shifting original offsets', () => {
  const text = 'İ😀 Text ТЕКСТ текст'
  for (const match of findDocumentMatches(text, 'текст', 0))
    expect(text.slice(match.from, match.to).toLowerCase()).toBe('текст')
  expect(findDocumentMatches(text, 'текст', 0)).toHaveLength(2)
  expect(findDocumentMatches(text, '   ', 0)).toEqual([])
})
