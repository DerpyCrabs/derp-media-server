import { Effect } from 'effect'
import { controllerView, modelOwner, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import { parsePageRanges } from '@/lib/printing/page-ranges'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { printPdf } from './print-pdf'
import type { PdfDocument } from './PdfContent'

type Props = {
  pdf: PdfDocument
  path: string
  currentPage: number
  embedded: boolean
  onClose: () => void
}
export const PdfPrintDialog = controllerView(
  {
    controller: (props: Props) => {
      const owner = modelOwner({ props, range: 'All', pending: false, completed: 0, error: '' })
      const actions = {
        range: (range: string) => owner.patch({ range, error: '' }),
        close: () => {
          owner.cancel('print')
          owner.read().props.onClose()
        },
        print: () => {
          const current = owner.read(),
            pages = parsePageRanges(current.range, current.props.pdf.numPages)
          if (!pages || current.pending) return
          if (pages.length > 100) {
            owner.patch({
              error:
                'Choose up to 100 pages at a time, or download the original to print it in another app.',
            })
            return
          }
          owner.patch({ pending: true, completed: 0, error: '' })
          owner.run(
            'print',
            printPdf(
              current.props.pdf,
              pages,
              current.props.path.split('/').at(-1) ?? 'Document',
              (completed) => owner.patch({ completed }),
            ).pipe(
              Effect.tap(() => Effect.sync(() => owner.read().props.onClose())),
              Effect.catch((error) =>
                Effect.sync(() =>
                  owner.patch({
                    pending: false,
                    error:
                      error instanceof Error ? error.message : 'Could not print this document.',
                  }),
                ),
              ),
            ),
            'drop',
          )
        },
      }
      return {
        source: owner.source,
        ...actions,
        receive: (next: Props) => owner.patch({ props: next }),
        lifetime: owner,
      }
    },
  },
  view((model) => {
    const pages = parsePageRanges(model.range, model.props.pdf.numPages)
    return (
      <div
        data-no-window-drag
        class={`${modalDialogBackdropClass(model.props.embedded ? 'window' : 'viewport')} z-[80]`}
      >
        <form
          role='dialog'
          aria-modal='true'
          aria-label='Print PDF'
          class='flex max-h-full w-full max-w-sm flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-xl'
          use={modalFocus({ onEscape: model.actions.close })}
          onSubmit={(event) => {
            event.preventDefault()
            model.actions.print()
          }}
        >
          <h2 class='text-base font-semibold'>Print PDF</h2>
          <label class='flex flex-col gap-1 text-sm'>
            Pages
            <input
              aria-label='Pages to print'
              autofocus
              class='rounded border border-input bg-background px-3 py-2'
              value={model.range}
              disabled={model.pending}
              onInput={(event) => model.actions.range(event.currentTarget.value)}
            />
          </label>
          <p class='text-xs text-muted-foreground'>
            All, or page numbers such as 1–3, 5. {model.props.pdf.numPages} pages in this document.
          </p>
          <div class='flex gap-3 text-xs'>
            <button
              type='button'
              class='underline disabled:opacity-40'
              disabled={model.pending}
              onClick={() => model.actions.range('All')}
            >
              All pages
            </button>
            <button
              type='button'
              class='underline disabled:opacity-40'
              disabled={model.pending}
              onClick={() => model.actions.range(String(model.props.currentPage + 1))}
            >
              Current page
            </button>
          </div>
          {!pages ? (
            <p role='alert' class='text-sm text-destructive'>
              Enter valid page numbers separated by commas, or a range such as 1-3.
            </p>
          ) : null}
          {model.error ? (
            <p role='alert' class='text-sm text-destructive'>
              {model.error}
            </p>
          ) : null}
          {model.pending ? (
            <p role='status' class='text-sm'>
              {model.completed === pages?.length
                ? 'Print dialog opened. Close it to return to the document.'
                : `Preparing page ${Math.min(model.completed + 1, pages?.length ?? 0)} of ${pages?.length ?? 0}…`}
            </p>
          ) : null}
          <div class='flex flex-wrap items-center justify-end gap-2'>
            <a class='mr-auto text-xs underline' href={fileDownloadHref(model.props.path)} download>
              Download original
            </a>
            <button
              type='button'
              class='rounded border border-input px-3 py-1.5 text-sm hover:bg-muted'
              onClick={model.actions.close}
            >
              Cancel
            </button>
            <button
              type='submit'
              class='rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40'
              disabled={model.pending || !pages}
            >
              {model.pending ? 'Preparing…' : 'Print'}
            </button>
          </div>
        </form>
      </div>
    )
  }),
)
