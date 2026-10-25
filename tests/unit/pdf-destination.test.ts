import { expect, test } from 'bun:test'
import { resolvePdfDestination } from '@/features/reader/contentTypes/pdf/pdf-destination'
import { mapPdfOutline } from '@/features/reader/contentTypes/pdf/pdf-outline'
import { Effect } from 'effect'
import type { PdfDocument } from '@/features/reader/contentTypes/pdf/PdfContent'
const document = {
  numPages: 4,
  getDestination: async (name: string) =>
    name === 'chapter' ? [{ num: 7, gen: 0 }, { name: 'Fit' }] : null,
  getPageIndex: async ({ num }: { num: number; gen: number }) => (num === 7 ? 2 : -1),
}
test('PDF destinations accept zero-based page indices, named targets and references', async () => {
  expect(await resolvePdfDestination(document, [0, { name: 'Fit' }])).toBe(0)
  expect(await resolvePdfDestination(document, [3, { name: 'Fit' }])).toBe(3)
  expect(await resolvePdfDestination(document, 'chapter')).toBe(2)
  expect(await resolvePdfDestination(document, 'missing')).toBeNull()
  for (const target of [[-1], [4], [1.5], [null], {}, [{ num: '7', gen: 0 }]])
    expect(await resolvePdfDestination(document, target)).toBeNull()
})
test('numeric PDF outline destinations no longer all resolve to page one', async () => {
  const outline = await Effect.runPromise(
    mapPdfOutline(
      document as PdfDocument,
      [{ title: 'Last chapter', dest: [3, { name: 'Fit' }], items: [] }] as unknown as Awaited<
        ReturnType<PdfDocument['getOutline']>
      >,
    ),
  )
  expect(outline[0]?.target).toBe(3)
})
