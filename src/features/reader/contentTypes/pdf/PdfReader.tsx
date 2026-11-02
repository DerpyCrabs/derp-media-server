import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { Effect, Exit } from 'effect'
import { view, controllerView, modelOwner, domBinding } from 'effectweb'
import { Dialog } from '@/lib/ui/dialog'
import { closeReader } from '../../reader-url'
import * as pdfjs from 'pdfjs-dist'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { PdfContent, type PdfDocument } from './PdfContent'
import { mapPdfOutline } from './pdf-outline'
import { PagedReader, type PagedDocument } from '../paged/PagedReader'
import type { ReaderPage } from '../../reader-position'
import type { ReaderContentProps } from '../../reader-types'
type PdfReaderDocument = PagedDocument & { pdf: PdfDocument }
type PasswordRequest = (update: (password: string | Error) => void, reason: number) => void
const loadPdf = (
  path: string,
  onPassword: PasswordRequest,
  onUnlocked: () => void,
): Effect.Effect<PdfReaderDocument, unknown> =>
  Effect.gen(function* () {
    const task = pdfjs.getDocument({
      url: buildMediaUrl(path.replace(/\\/g, '/')),
      withCredentials: true,
    })
    task.onPassword = onPassword
    const destroy = yield* Effect.cached(Effect.promise(() => task.destroy()))
    return yield* Effect.gen(function* () {
      const pdf = yield* Effect.tryPromise({ try: () => task.promise, catch: (error) => error })
      onUnlocked()
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
        { concurrency: 8 },
      )
      const outline = yield* Effect.tryPromise({
        try: () => pdf.getOutline(),
        catch: (error) => error,
      }).pipe(Effect.flatMap((items) => mapPdfOutline(pdf, items)))
      const textCache = new Map<number, string>()
      const pageText = (index: number) =>
        Effect.tryPromise(async () => {
          const cached = textCache.get(index)
          if (cached !== undefined) return cached
          const page = await pdf.getPage(index + 1)
          const content = await page.getTextContent()
          const text = content.items.map((item) => ('str' in item ? item.str : '')).join('')
          textCache.set(index, text)
          return text
        })
      return { pdf, pages, outline, pageText, release: () => destroy }
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? destroy : Effect.void)))
  })

const passwordFocus = (input: HTMLInputElement, current: () => boolean) => {
  let previous = current()
  const update = () => {
    const pending = current()
    if (previous && !pending)
      queueMicrotask(() => {
        if (input.isConnected) input.focus()
      })
    previous = pending
  }
  return { update, dispose: () => undefined }
}
function pdfController(props: ReaderContentProps) {
  let updatePassword: ((password: string | Error) => void) | undefined
  const owner = modelOwner({
    props,
    passwordOpen: false,
    password: '',
    incorrect: false,
    unlocking: false,
  })
  const actions = {
    password: (password: string) => owner.patch({ password }),
    unlock: () => {
      const current = owner.read()
      if (!updatePassword || current.unlocking) return
      owner.patch({ password: '', unlocking: true })
      updatePassword(current.password)
    },
    cancel: () => {
      updatePassword?.(new Error('Password entry cancelled.'))
      updatePassword = undefined
      owner.patch({ passwordOpen: false, password: '' })
      const onClose = owner.read().props.onClose
      if (onClose) onClose()
      else closeReader()
    },
    load: (path: string) =>
      loadPdf(
        path,
        (update, reason) => {
          updatePassword = update
          owner.patch({
            passwordOpen: true,
            password: '',
            incorrect: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
            unlocking: false,
          })
        },
        () => {
          updatePassword = undefined
          owner.patch({ passwordOpen: false, password: '', unlocking: false })
        },
      ),
  }
  return {
    source: owner.source,
    ...actions,
    receive: (next: ReaderContentProps) => owner.patch({ props: next }),
    lifetime: owner,
  }
}
const PdfReader = controllerView(
  { controller: pdfController, identity: (props) => props.sourcePath },
  view((model) => {
    const props = model.props
    return (
      <div class='relative h-full min-h-0'>
        <PagedReader
          {...props}
          load={model.actions.load}
          selectionModes={['text', 'image']}
          renderPage={({
            document,
            page,
            pageIndex,
            zoom,
            frame,
            searchQuery,
            activeMatch,
            onNavigatePage,
          }) => {
            return (
              <PdfContent
                document={(document as PdfReaderDocument).pdf}
                page={page}
                pageIndex={pageIndex}
                zoom={zoom}
                selectionMode={frame.selectionMode}
                onRegion={frame.selectRegion}
                searchQuery={searchQuery}
                activeMatch={activeMatch}
                onNavigatePage={onNavigatePage}
              />
            )
          }}
        />
        {model.passwordOpen ? (
          <Dialog
            open={model.passwordOpen}
            onOpenChange={(open) => {
              if (!open) model.actions.cancel()
            }}
            title='Unlock PDF'
          >
            <form
              class='space-y-4'
              onSubmit={(event) => {
                event.preventDefault()
                model.actions.unlock()
              }}
            >
              <label class='flex flex-col gap-1 text-sm'>
                Password
                <Input
                  use={domBinding(model.unlocking, passwordFocus)}
                  type='password'
                  aria-label='PDF password'
                  autofocus
                  autocomplete='off'
                  value={model.password}
                  disabled={model.unlocking}
                  class='rounded border border-input bg-background px-3 py-2'
                  onInput={(event) => model.actions.password(event.currentTarget.value)}
                />
              </label>
              {model.incorrect ? (
                <p role='alert' class='text-sm text-destructive'>
                  Incorrect password. Try again.
                </p>
              ) : null}
              <div class='flex justify-end gap-2'>
                <Button
                  variant='outline'
                  type='button'
                  class='rounded border border-input px-3 py-1.5 text-sm hover:bg-muted'
                  onClick={model.actions.cancel}
                >
                  Cancel
                </Button>
                <Button
                  variant='default'
                  type='submit'
                  class='rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40'
                  disabled={model.unlocking}
                >
                  {model.unlocking ? 'Unlocking…' : 'Unlock'}
                </Button>
              </div>
            </form>
          </Dialog>
        ) : null}
      </div>
    )
  }),
)

export default PdfReader
