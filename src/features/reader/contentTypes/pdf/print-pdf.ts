import { Effect } from 'effect'
import type { PdfDocument } from './PdfContent'

export function printPdf(
  document: PdfDocument,
  pages: readonly number[],
  title: string,
  progress: (completed: number) => void,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const frame = window.document.createElement('iframe')
      frame.title = 'PDF print document'
      frame.name = `derp-print-${crypto.randomUUID()}`
      frame.setAttribute('aria-hidden', 'true')
      frame.style.cssText =
        'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0'
      window.document.body.append(frame)
      const doc = frame.contentDocument!
      doc.open()
      doc.write('<!doctype html><html><head></head><body></body></html>')
      doc.close()
      doc.title = title
      const style = doc.createElement('style')
      style.textContent =
        'html,body{margin:0;padding:0;background:white}section{break-after:page;overflow:hidden}section:last-child{break-after:auto}img{display:block;width:100%;height:100%}'
      doc.head.append(style)
      return { frame, doc, style, urls: [] as string[] }
    }),
    ({ frame, doc, style, urls }) =>
      Effect.gen(function* () {
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
        if (window.derpDesktop) {
          if (!window.derpDesktop.printFrame)
            return yield* Effect.fail(
              new Error(
                'Update the desktop client to use native printing, or download the original.',
              ),
            )
          return yield* Effect.tryPromise({
            try: () => window.derpDesktop!.printFrame!(frame.name),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
        }
        return yield* Effect.callback<void, Error>((resume) => {
          const target = frame.contentWindow!
          const after = () => resume(Effect.void)
          target.addEventListener('afterprint', after, { once: true })
          try {
            target.focus()
            target.print()
          } catch (error) {
            resume(Effect.fail(error instanceof Error ? error : new Error(String(error))))
          }
          return Effect.sync(() => target.removeEventListener('afterprint', after))
        })
      }),
    ({ frame, urls }) =>
      Effect.sync(() => {
        void window.derpDesktop?.cancelPrint?.(frame.name).catch(() => {})
        frame.remove()
        for (const url of urls) URL.revokeObjectURL(url)
      }),
  )
}
