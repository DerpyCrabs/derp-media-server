import * as pdfjs from 'pdfjs-dist'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { PdfContent, type PdfDocument } from './PdfContent'
import { mapPdfOutline } from './pdf-outline'
import { PagedReader, type PagedDocument } from '../paged/PagedReader'
import type { ReaderPage } from '../../reader-position'
import type { ReaderContentProps } from '../../reader-types'

type PdfReaderDocument = PagedDocument & { pdf: PdfDocument }
type DestroyablePdfDocument = PdfDocument & { destroy: () => Promise<void> }

async function loadPdf(path: string, signal: AbortSignal): Promise<PdfReaderDocument> {
  const task = pdfjs.getDocument({
    url: buildMediaUrl(path.replace(/\\/g, '/')),
    withCredentials: true,
  })
  const abort = () => void task.destroy()
  signal.addEventListener('abort', abort, { once: true })
  let pdf: DestroyablePdfDocument | undefined
  try {
    pdf = (await task.promise) as DestroyablePdfDocument
    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index): Promise<ReaderPage> => {
        const page = await pdf!.getPage(index + 1)
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
    )
    const outline = await mapPdfOutline(pdf, await pdf.getOutline())
    signal.throwIfAborted()
    signal.removeEventListener('abort', abort)
    return {
      pdf,
      pages,
      outline,
      release: () => void pdf!.destroy(),
    }
  } catch (error) {
    signal.removeEventListener('abort', abort)
    if (pdf && !signal.aborted) await pdf.destroy()
    throw error
  }
}

export default function PdfReader(props: ReaderContentProps) {
  return (
    <PagedReader
      {...props}
      load={loadPdf}
      selectionModes={['text', 'image']}
      renderPage={({ document, page, pageIndex, zoom, frame }) => (
        <PdfContent
          document={document.pdf}
          page={page}
          pageIndex={pageIndex}
          zoom={zoom}
          selectionMode={frame.selectionMode()}
          onRegion={frame.selectRegion}
        />
      )}
    />
  )
}
