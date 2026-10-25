import { Effect } from 'effect'
import { controllerView, domBinding, modelOwner, Portal, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { printFrame } from '@/lib/printing/print-frame'
import {
  buildTextPrint,
  countPrintLines,
  textPrintDefaults,
  textPrintHtml,
  type TextPrintOptions,
} from '@/lib/printing/text-print'
import { buildResolveMarkdownImageUrl } from '@/lib/markdown/resolve-markdown-image-url'

export type TextPrintProps = {
  path: string
  content: string
  dirty: boolean
  knowledgeBases: string[]
  onClose: () => void
}
function loadImage(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    const image = new Image()
    const finish = (success: number) => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      resolve(success)
    }
    const abort = () => finish(0)
    const timeout = setTimeout(abort, 8000)
    image.onload = () => {
      const pixels = image.naturalWidth * image.naturalHeight
      finish(pixels > 0 && pixels <= 40_000_000 ? pixels : 0)
    }
    image.onerror = abort
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else {
      image.referrerPolicy = 'no-referrer'
      image.src = url
    }
  })
}
function previewBinding(frame: HTMLIFrameElement, current: () => { width: number }) {
  const parent = frame.parentElement!
  const resize = () => {
    const width = current().width
    const scale = Math.max(0.1, Math.min(1, (parent.clientWidth - 18) / width))
    frame.style.width = `${parent.clientWidth / scale}px`
    frame.style.height = `${parent.clientHeight / Math.max(0.1, scale)}px`
    frame.style.zoom = String(scale)
  }
  let doc: Document | null = null
  const click = (event: MouseEvent) => {
    if ((event.target as Element).closest('a')) event.preventDefault()
  }
  const load = () => {
    doc?.removeEventListener('click', click)
    doc = frame.contentDocument
    doc?.addEventListener('click', click)
    doc?.querySelectorAll('a').forEach((link) => (link.tabIndex = -1))
    resize()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(parent)
  frame.addEventListener('load', load)
  load()
  return () => {
    observer.disconnect()
    frame.removeEventListener('load', load)
    doc?.removeEventListener('click', click)
  }
}
function controller(props: TextPrintProps) {
  const markdown = /\.md$/i.test(props.path)
  const lineCount = countPrintLines(props.content)
  const name = props.path.split('/').at(-1) || 'Document'
  const owner = modelOwner({
    options: { ...textPrintDefaults(markdown), to: lineCount },
    markdown,
    lineCount,
    name,
    dirty: props.dirty,
    html: '',
    pending: false,
    loading: false,
    error: '',
    missing: 0,
  })
  const images = new Map<string, boolean>()
  const resolveImage = buildResolveMarkdownImageUrl(props.path, props.knowledgeBases)
  let revision = 0
  let decodedPixels = 0
  const rebuild = () => {
    const currentRevision = ++revision
    owner.cancel('images')
    try {
      const result = buildTextPrint(props.content, name, owner.read().options)
      const doc = new DOMParser().parseFromString(result.body, 'text/html')
      const targets = [...doc.querySelectorAll<HTMLImageElement>('img[data-print-image]')].map(
        (image) => {
          const source = result.images[Number(image.dataset.printImage)]!
          const resolved = resolveImage(source.source)
          let url = ''
          try {
            const parsed = new URL(resolved || '', window.location.href)
            if (resolved && ['http:', 'https:'].includes(parsed.protocol)) url = parsed.href
          } catch {}
          return { image, url, alt: source.alt }
        },
      )
      const unknown = [
        ...new Set(targets.map((target) => target.url).filter((url) => url && !images.has(url))),
      ]
      owner.patch({ error: '', loading: unknown.length > 0, html: '', missing: 0 })
      const update = () => {
        if (currentRevision !== revision) return
        let missing = 0
        for (const target of targets) {
          if (images.get(target.url)) {
            target.image.src = target.url
            target.image.referrerPolicy = 'no-referrer'
          } else {
            missing++
            const placeholder = doc.createElement('span')
            placeholder.className = 'missing-image'
            placeholder.textContent = target.alt ? `[Image: ${target.alt}]` : '[Image unavailable]'
            target.image.replaceWith(placeholder)
          }
        }
        owner.patch({
          html: textPrintHtml(name, doc.body.innerHTML, result.css),
          loading: false,
          missing,
        })
      }
      if (!unknown.length) update()
      else
        owner.run(
          'images',
          Effect.tryPromise({
            try: async (signal) => {
              let index = 0
              const deadline = Date.now() + 20000
              await Promise.all(
                Array.from({ length: Math.min(4, unknown.length) }, async () => {
                  while (index < unknown.length && !signal.aborted) {
                    const url = unknown[index++]!
                    const pixels =
                      decodedPixels < 80_000_000 && Date.now() < deadline
                        ? await loadImage(url, signal)
                        : 0
                    if (!signal.aborted) {
                      const okay = pixels > 0 && decodedPixels + pixels <= 80_000_000
                      images.set(url, okay)
                      if (okay) decodedPixels += pixels
                    }
                  }
                }),
              )
            },
            catch: (error) => error,
          }).pipe(
            Effect.tap(() => Effect.sync(update)),
            Effect.catch(() => Effect.sync(update)),
          ),
          'replace',
        )
    } catch (error) {
      owner.patch({
        html: '',
        loading: false,
        error: error instanceof Error ? error.message : 'Could not prepare this document.',
      })
    }
  }
  const close = () => {
    owner.cancel('print')
    props.onClose()
  }
  const options = (patch: Partial<TextPrintOptions>) => {
    if (!owner.read().pending) {
      owner.patch({ options: { ...owner.read().options, ...patch } })
      rebuild()
    }
  }
  const print = () => {
    const { html, loading, pending } = owner.read()
    if (!html || loading || pending) return
    owner.patch({ pending: true, error: '' })
    owner.run(
      'print',
      printFrame(name, 'Text print document', ({ doc }) =>
        Effect.tryPromise({
          try: async (signal) => {
            doc.open()
            doc.write(html)
            doc.close()
            await Promise.all(
              [...doc.images].map(
                (image) =>
                  new Promise<void>((resolve) => {
                    const done = () => {
                      clearTimeout(timeout)
                      signal.removeEventListener('abort', done)
                      image.onload = null
                      image.onerror = null
                      resolve()
                    }
                    const timeout = setTimeout(done, 8000)
                    image.onload = done
                    image.onerror = done
                    signal.addEventListener('abort', done, { once: true })
                    if (image.complete || signal.aborted) done()
                  }),
              ),
            )
            signal.throwIfAborted()
            await doc.fonts.ready
          },
          catch: (error) =>
            error instanceof Error ? error : new Error('Could not prepare printing.'),
        }),
      ).pipe(
        Effect.tap(() => Effect.sync(close)),
        Effect.catch((error) =>
          Effect.sync(() =>
            owner.patch({
              pending: false,
              error: error instanceof Error ? error.message : 'Printing failed.',
            }),
          ),
        ),
      ),
      'replace',
    )
  }
  rebuild()
  return { source: owner.source, options, print, close, lifetime: owner }
}
export const TextPrintDialog = controllerView(
  { controller },
  view((model) => {
    const field = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm'
    const label = 'flex flex-col gap-1 text-sm'
    const options = model.options
    return (
      <Portal>
        <div
          class='fixed inset-0 z-[1000003] flex items-center justify-center bg-black/60 p-3'
          onClick={(event) => {
            if (event.target === event.currentTarget) model.actions.close()
          }}
        >
          <section
            role='dialog'
            aria-modal='true'
            aria-label='Print document'
            class='flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl'
            use={modalFocus({ onEscape: model.actions.close })}
          >
            <header class='flex items-center justify-between border-b border-border px-4 py-3'>
              <h2 class='font-semibold'>Print document</h2>
              <button
                type='button'
                aria-label='Close print dialog'
                class='rounded px-2 py-1 hover:bg-accent'
                onClick={model.actions.close}
              >
                ✕
              </button>
            </header>
            <div class='grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-[230px_minmax(0,1fr)]'>
              <fieldset disabled={model.pending} class='space-y-3 p-4 disabled:opacity-60'>
                {model.markdown ? (
                  <label class={label}>
                    Content
                    <select
                      class={field}
                      aria-label='Print content'
                      value={options.format}
                      onChange={(event) =>
                        model.actions.options({
                          format: event.currentTarget.value === 'markdown' ? 'markdown' : 'source',
                        })
                      }
                    >
                      <option value='markdown'>Formatted Markdown</option>
                      <option value='source'>Source text</option>
                    </select>
                  </label>
                ) : null}
                <div class='grid grid-cols-2 gap-2'>
                  <label class={label}>
                    Paper
                    <select
                      class={field}
                      aria-label='Paper'
                      value={options.paper}
                      onChange={(event) =>
                        model.actions.options({
                          paper: event.currentTarget.value === 'letter' ? 'letter' : 'a4',
                        })
                      }
                    >
                      <option value='a4'>A4</option>
                      <option value='letter'>Letter</option>
                    </select>
                  </label>
                  <label class={label}>
                    Orientation
                    <select
                      class={field}
                      aria-label='Orientation'
                      value={options.orientation}
                      onChange={(event) =>
                        model.actions.options({
                          orientation:
                            event.currentTarget.value === 'landscape' ? 'landscape' : 'portrait',
                        })
                      }
                    >
                      <option value='portrait'>Portrait</option>
                      <option value='landscape'>Landscape</option>
                    </select>
                  </label>
                </div>
                <label class={label}>
                  Font size (pt)
                  <input
                    type='number'
                    class={field}
                    min='8'
                    max='24'
                    value={String(options.fontSize)}
                    onInput={(event) =>
                      model.actions.options({ fontSize: Number(event.currentTarget.value) })
                    }
                  />
                </label>
                <label class={label}>
                  Range
                  <select
                    class={field}
                    aria-label='Print range'
                    value={options.range}
                    onChange={(event) =>
                      model.actions.options({
                        range: event.currentTarget.value === 'lines' ? 'lines' : 'all',
                      })
                    }
                  >
                    <option value='all'>Whole document</option>
                    <option value='lines'>Source line range</option>
                  </select>
                </label>
                {options.range === 'lines' ? (
                  <div class='grid grid-cols-2 gap-2'>
                    <label class={label}>
                      From line
                      <input
                        class={field}
                        type='number'
                        min='1'
                        max={model.lineCount}
                        value={String(options.from)}
                        onInput={(event) =>
                          model.actions.options({ from: Number(event.currentTarget.value) })
                        }
                      />
                    </label>
                    <label class={label}>
                      To line
                      <input
                        class={field}
                        type='number'
                        min='1'
                        max={model.lineCount}
                        value={String(options.to)}
                        onInput={(event) =>
                          model.actions.options({ to: Number(event.currentTarget.value) })
                        }
                      />
                    </label>
                  </div>
                ) : null}
                {options.format === 'source' ? (
                  <label class='flex items-center gap-2 text-sm'>
                    <input
                      type='checkbox'
                      checked={options.lineNumbers}
                      onChange={(event) =>
                        model.actions.options({ lineNumbers: event.currentTarget.checked })
                      }
                    />
                    Line numbers
                  </label>
                ) : null}
                <label class='flex items-center gap-2 text-sm'>
                  <input
                    type='checkbox'
                    checked={options.title}
                    onChange={(event) =>
                      model.actions.options({ title: event.currentTarget.checked })
                    }
                  />
                  File name heading
                </label>
                <p class='text-xs text-muted-foreground'>
                  {model.dirty
                    ? 'Includes your current unsaved changes.'
                    : 'Prints the document currently open.'}{' '}
                  Choose a printer or Save as PDF in the system print dialog.
                </p>
                {model.missing > 0 ? (
                  <p role='status' class='text-xs text-muted-foreground'>
                    {model.missing} image(s) could not be loaded and will print as placeholders.
                  </p>
                ) : null}
              </fieldset>
              <div class='relative h-64 min-h-64 overflow-hidden border-border bg-muted sm:h-full sm:min-h-[420px] sm:border-l'>
                {model.loading ? (
                  <p role='status' class='p-4 text-sm'>
                    Preparing images…
                  </p>
                ) : model.html ? (
                  <iframe
                    title='Document print preview'
                    sandbox='allow-same-origin'
                    srcdoc={model.html}
                    tabindex={-1}
                    use={domBinding(
                      {
                        width:
                          ((options.orientation === 'landscape'
                            ? options.paper === 'letter'
                              ? 279.4
                              : 297
                            : options.paper === 'letter'
                              ? 215.9
                              : 210) *
                            96) /
                            25.4 +
                          16,
                      },
                      previewBinding,
                    )}
                    class='border-0'
                  />
                ) : (
                  <p class='p-4 text-sm text-muted-foreground'>
                    Adjust the options to show the print preview.
                  </p>
                )}
              </div>
            </div>
            <footer class='flex flex-wrap items-center justify-end gap-2 border-t border-border p-3'>
              {model.error ? (
                <p role='alert' class='mr-auto max-w-full text-sm text-destructive'>
                  {model.error}
                </p>
              ) : null}
              <button
                type='button'
                class='rounded-md px-3 py-2 text-sm hover:bg-accent'
                onClick={model.actions.close}
              >
                {model.pending ? 'Cancel printing' : 'Cancel'}
              </button>
              <button
                type='button'
                class='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40'
                disabled={model.pending || model.loading || !model.html}
                onClick={model.actions.print}
              >
                {model.pending ? 'Printing…' : 'Print'}
              </button>
            </footer>
          </section>
        </div>
      </Portal>
    )
  }),
)
