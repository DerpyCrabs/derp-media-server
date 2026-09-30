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
        const target = yield* Effect.gen(function* () {
          const destination =
            typeof item.dest === 'string'
              ? yield* Effect.tryPromise(() => document.getDestination(item.dest as string))
              : item.dest
          if (!destination?.[0]) return 0
          return yield* Effect.tryPromise(() =>
            document.getPageIndex(destination[0] as Parameters<PdfDocument['getPageIndex']>[0]),
          )
        }).pipe(Effect.catch(() => Effect.succeed(0)))
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
