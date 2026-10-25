import { printFrame } from '@/lib/printing/print-frame'
import { AnnotationMode } from 'pdfjs-dist'
import { Effect } from 'effect'
import type { PdfDocument } from './PdfContent'

export function printPdf(
  document: PdfDocument,
  pages: readonly number[],
  title: string,
  progress: (completed: number) => void,
) {
  return printFrame(title, 'PDF print document', ({ doc, style, urls }) =>
    Effect.gen(function* () {
      const printAnnotationStorage = document.annotationStorage.print
      let pixels = 0
      for (const [index, number] of pages.entries()) {
        const page = yield* Effect.tryPromise(() => document.getPage(number + 1))
        const points = page.getViewport({ scale: 1 })
        const scale = Math.min(150 / 72, 4096 / Math.max(points.width, points.height))
        const viewport = page.getViewport({ scale })
        pixels += Math.ceil(viewport.width) * Math.ceil(viewport.height)
        if (pixels > 160_000_000)
          return yield* Effect.fail(
            new Error(
              'This selection is too large to print in the browser. Choose a smaller page range, or download the original.',
            ),
          )
        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            const canvas = doc.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            return canvas
          }),
          (canvas) =>
            Effect.gen(function* () {
              const task = page.render({
                canvas,
                canvasContext: canvas.getContext('2d')!,
                viewport,
                intent: 'print',
                annotationMode: AnnotationMode.ENABLE_STORAGE,
                printAnnotationStorage,
                background: '#fff',
              })
              yield* Effect.tryPromise(() => task.promise).pipe(
                Effect.ensuring(Effect.sync(() => task.cancel())),
              )
              const blob = yield* Effect.tryPromise(
                () =>
                  new Promise<Blob>((resolve, reject) =>
                    canvas.toBlob(
                      (blob) =>
                        blob
                          ? resolve(blob)
                          : reject(new Error('Could not prepare this page for printing.')),
                      'image/png',
                    ),
                  ),
              )
              const url = URL.createObjectURL(blob)
              urls.push(url)
              const section = doc.createElement('section'),
                image = doc.createElement('img')
              section.style.width = `${points.width}pt`
              section.style.height = `${points.height}pt`
              section.style.page = `pdf-page-${index}`
              style.textContent += `@page pdf-page-${index}{size:${points.width}pt ${points.height}pt;margin:0}`
              image.src = url
              image.alt = `Page ${number + 1}`
              section.append(image)
              doc.body.append(section)
              yield* Effect.tryPromise(() => image.decode())
            }),
          (canvas) =>
            Effect.sync(() => {
              canvas.width = canvas.height = 1
            }),
        )
        progress(index + 1)
      }
      return yield* Effect.void
    }),
  )
}
