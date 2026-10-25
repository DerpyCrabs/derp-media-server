import { resolvePdfDestination } from './pdf-destination'
import { Effect } from 'effect'
import type { ReaderOutlineItem } from '../../ReaderOutline'
import type { PdfDocument } from './PdfContent'

export function mapPdfOutline(
  document: PdfDocument,
  items: Awaited<ReturnType<PdfDocument['getOutline']>>,
): Effect.Effect<ReaderOutlineItem[]> {
  return Effect.forEach(
    items ?? [],
    (item, index) =>
      Effect.gen(function* () {
        const target = yield* Effect.tryPromise(() =>
          resolvePdfDestination(document, item.dest),
        ).pipe(
          Effect.map((index) => index ?? 0),
          Effect.catch(() => Effect.succeed(0)),
        )
        return {
          id: `pdf-outline-${index}-${item.title}`,
          label: item.title || `Page ${target + 1}`,
          target,
          children: yield* mapPdfOutline(document, item.items),
        }
      }),
    { concurrency: 'unbounded' },
  )
}
