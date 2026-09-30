import { Effect, Exit } from 'effect'
import { view, type Snapshot } from 'effectweb'
import * as pdfjs from 'pdfjs-dist'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { PdfContent, type PdfDocument } from './PdfContent'
import { mapPdfOutline } from './pdf-outline'
import { PagedReader, type PagedDocument } from '../paged/PagedReader'
import type { ReaderPage } from '../../reader-position'
import type { ReaderContentProps } from '../../reader-types'
type PdfReaderDocument = PagedDocument & { pdf: PdfDocument }
const loadPdf = (path: string): Effect.Effect<PdfReaderDocument, unknown> =>
  Effect.gen(function* () {
    const task = pdfjs.getDocument({
      url: buildMediaUrl(path.replace(/\\/g, '/')),
      withCredentials: true,
    })
    const destroy = yield* Effect.cached(Effect.promise(() => task.destroy()))
    return yield* Effect.gen(function* () {
      const pdf = yield* Effect.tryPromise({ try: () => task.promise, catch: (error) => error })
      const pages = yield* Effect.forEach(
        Array.from({ length: pdf.numPages }, (_, index) => index),
        (index) =>
          Effect.tryPromise({ try: () => pdf.getPage(index + 1), catch: (error) => error }).pipe(
            Effect.map((page): ReaderPage => {
              const viewport = page.getViewport({ scale: 1 })
              return {
                id: `${path}#${index + 1}`,
                name: `Page ${index + 1}`,
                source: buildMediaUrl(path.replace(/\\/g, '/')),
                width: viewport.width,
                height: viewport.height,
                kind: 'pdf',
              }
            }),
          ),
        { concurrency: 'unbounded' },
      )
      const outline = yield* Effect.tryPromise({
        try: () => pdf.getOutline(),
        catch: (error) => error,
      }).pipe(Effect.flatMap((items) => mapPdfOutline(pdf, items)))
      return { pdf, pages, outline, release: () => destroy }
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? destroy : Effect.void)))
  })

const PdfReader = view<ReaderContentProps>((props) => {
  return (
    <PagedReader
      {...props}
      load={loadPdf}
      selectionModes={['text', 'image']}
      renderPage={({ document, page, pageIndex, zoom, frame }) => (
        <PdfContent
          document={(document as Snapshot<PdfReaderDocument>).pdf}
          page={page}
          pageIndex={pageIndex}
          zoom={zoom}
          selectionMode={frame.selectionMode}
          onRegion={frame.selectRegion}
        />
      )}
    />
  )
})

export default PdfReader
