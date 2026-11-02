import ChevronLeft from '@effectweb/lucide/icons/chevron-left'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { Select } from '@/lib/ui/select'
import { Effect } from 'effect'
import * as pdfjs from 'pdfjs-dist'
import { controllerView, domBinding, modelOwner, view } from 'effectweb'
import { PdfContent } from '@/features/reader/contentTypes/pdf/PdfContent'
import type { ReaderPage } from '@/features/reader/reader-position'
type Props = { blob: Blob; name: string }
function controller(props: Props) {
  const owner = modelOwner({
    props,
    document: null as pdfjs.PDFDocumentProxy | null,
    page: null as ReaderPage | null,
    index: 0,
    input: '1',
    count: 0,
    width: 600,
    ratio: Math.max(1, window.devicePixelRatio),
    zoom: 'fit' as 'fit' | number,
    error: '',
  })
  function navigate(index: number) {
    const document = owner.read().document
    if (!document) return
    const next = Math.max(0, Math.min(document.numPages - 1, index))
    owner.patch({ page: null, index: next, input: String(next + 1), error: '' })
    owner.run(
      'page',
      Effect.tryPromise(() => document.getPage(next + 1)).pipe(
        Effect.tap((page) =>
          Effect.sync(() => {
            const viewport = page.getViewport({ scale: 1 })
            owner.patch({
              page: {
                id: `${props.name}#${next}`,
                name: `Page ${next + 1}`,
                source: '',
                width: viewport.width,
                height: viewport.height,
                kind: 'pdf',
              },
            })
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => owner.patch({ error: 'Could not render this PDF page.' })),
        ),
      ),
      'replace',
    )
  }
  owner.run(
    'load',
    Effect.gen(function* () {
      const data = yield* Effect.tryPromise(() => props.blob.arrayBuffer())
      const task = pdfjs.getDocument({ data })
      owner.own({
        dispose: () => {
          void task.destroy().catch(() => {})
        },
      })
      const document = yield* Effect.tryPromise(() => task.promise)
      owner.patch({ document, count: document.numPages })
      navigate(0)
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() =>
          owner.patch({
            error:
              'This PDF cannot be previewed. If it is encrypted, download or extract it and open it in the document reader.',
          }),
        ),
      ),
    ),
    'drop',
  )
  return {
    source: owner.source,
    navigate,
    input: (input: string) => owner.patch({ input }),
    jump: () => {
      const value = Number(owner.read().input)
      if (Number.isInteger(value) && value > 0) navigate(value - 1)
    },
    zoom: (zoom: 'fit' | number) => owner.patch({ zoom }),
    width: (width: number) => {
      if (width !== owner.read().width)
        owner.patch({ width, ratio: Math.max(1, window.devicePixelRatio) })
    },
    lifetime: owner,
  }
}
const measure = (element: HTMLDivElement, current: () => (width: number) => void) => {
  const update = () => current()(element.clientWidth)
  const observer = new ResizeObserver(update)
  observer.observe(element)
  update()
  return () => observer.disconnect()
}
export default controllerView(
  { controller },
  view((model) => {
    const page = model.page
    const scale = page
      ? Math.min(
          model.zoom === 'fit' ? Math.max(0.1, (model.width - 32) / page.width) : model.zoom,
          Math.sqrt(16_000_000 / (page.width * page.height)) / model.ratio,
        )
      : 1
    return (
      <div class='flex h-full min-h-0 flex-col'>
        <div class='flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border p-2'>
          <Button
            variant='outline'
            size='icon'
            aria-label='Previous page'
            disabled={!model.document || model.index === 0}
            onClick={() => model.actions.navigate(model.index - 1)}
          >
            <ChevronLeft />
          </Button>
          <form
            class='flex items-center gap-1 text-sm'
            onSubmit={(event) => {
              event.preventDefault()
              model.actions.jump()
            }}
          >
            <Input
              aria-label='Preview PDF page'
              class='w-14 text-center'
              inputMode='numeric'
              value={model.input}
              onInput={(event) => model.actions.input(event.currentTarget.value)}
            />
            <span>/ {model.count || '…'}</span>
          </form>
          <Button
            variant='outline'
            size='icon'
            aria-label='Next page'
            disabled={!model.document || model.index >= model.count - 1}
            onClick={() => model.actions.navigate(model.index + 1)}
          >
            <ChevronRight />
          </Button>
          <Select
            aria-label='PDF preview zoom'
            class='w-28'
            value={String(model.zoom)}
            onValueChange={(value) => model.actions.zoom(value === 'fit' ? 'fit' : Number(value))}
            options={[
              { value: 'fit', label: 'Fit width' },
              { value: '1', label: '100%' },
              { value: '1.5', label: '150%' },
              { value: '2', label: '200%' },
            ]}
          />
        </div>
        {model.error ? (
          <p role='alert' class='p-4 text-sm text-destructive'>
            {model.error}
          </p>
        ) : null}
        {!model.document && !model.error ? (
          <p role='status' class='p-4 text-sm'>
            Loading PDF…
          </p>
        ) : null}
        <div
          class='min-h-0 flex-1 overflow-auto bg-neutral-800 p-3'
          use={domBinding(model.actions.width, measure)}
        >
          {model.document && page ? (
            <div class='mx-auto w-max bg-white'>
              <PdfContent
                document={model.document}
                page={page}
                pageIndex={model.index}
                zoom={scale}
                selectionMode='text'
                onNavigatePage={model.actions.navigate}
                onRegion={() => {}}
              />
            </div>
          ) : null}
        </div>
      </div>
    )
  }),
)
