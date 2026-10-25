import type { PdfDocument } from './PdfContent'

export async function resolvePdfDestination(
  document: Pick<PdfDocument, 'numPages' | 'getDestination' | 'getPageIndex'>,
  destination: unknown,
): Promise<number | null> {
  const resolved: unknown =
    typeof destination === 'string' ? await document.getDestination(destination) : await destination
  if (!Array.isArray(resolved)) return null
  const reference: unknown = resolved[0]
  let index: number
  if (typeof reference === 'number' && Number.isInteger(reference)) index = reference
  else if (
    reference &&
    typeof reference === 'object' &&
    'num' in reference &&
    'gen' in reference &&
    typeof reference.num === 'number' &&
    typeof reference.gen === 'number'
  )
    index = await document.getPageIndex({ num: reference.num, gen: reference.gen })
  else return null
  return Number.isInteger(index) && index >= 0 && index < document.numPages ? index : null
}
