import { test, expect } from 'bun:test'
import { parsePageRanges } from '../../src/lib/printing/page-ranges'

test('print ranges support all pages, Unicode dashes and deduplicate overlapping selections', () => {
  expect(parsePageRanges('All', 4)).toEqual([0, 1, 2, 3])
  expect(parsePageRanges(' 1–3, 2, 5 ', 5)).toEqual([0, 1, 2, 4])
  expect(parsePageRanges('4,1', 4)).toEqual([0, 3])
})
test('print ranges reject invalid or out-of-document selections', () => {
  for (const range of ['0', '5', '3-1', '1,', '-2', '2.5', 'all pages', '1-5'])
    expect(parsePageRanges(range, 4)).toBeNull()
  expect(parsePageRanges('All', 0)).toBeNull()
})
