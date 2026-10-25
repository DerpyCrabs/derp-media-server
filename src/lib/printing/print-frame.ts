import { Effect } from 'effect'
import { randomId } from '@/lib/random-id'

export type PrintFrame = {
  frame: HTMLIFrameElement
  doc: Document
  style: HTMLStyleElement
  urls: string[]
}
export function printFrame<E>(
  title: string,
  label: string,
  prepare: (context: PrintFrame) => Effect.Effect<void, E>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const frame = window.document.createElement('iframe')
      frame.title = label
      frame.name = `derp-print-${randomId()}`
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
    (context) =>
      Effect.gen(function* () {
        const { frame } = context
        yield* prepare(context)
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
