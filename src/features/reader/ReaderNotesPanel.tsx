import { BrowserDownload } from '@/lib/ui/browser-download'
import { DropdownMenu } from '@/lib/ui/menu'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { Input, Textarea } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { domBinding, list, observe, view } from 'effectweb'
import type { ReaderNotesController } from './reader-notes-controller'
const focusForm = (element: HTMLFormElement) => {
  let disposed = false
  queueMicrotask(() => {
    if (!disposed) element.querySelector<HTMLElement>('[autofocus]')?.focus()
  })
  return () => {
    disposed = true
  }
}
export const ReaderNotesPanel = view<{ controller: ReaderNotesController }>(({ controller }) =>
  observe(controller.source, (model) => {
    const matches = model.items.filter((entry) =>
      `${entry.label} ${entry.quote} ${entry.note}`
        .toLocaleLowerCase()
        .includes(model.filter.toLocaleLowerCase()),
    )
    return (
      <section aria-label='Reading notes' class='min-h-0 flex-1 overflow-auto p-3 text-foreground'>
        {model.error ? (
          <div
            role='alert'
            class='mb-3 rounded border border-destructive/40 p-2 text-xs text-destructive'
          >
            <p>{model.error}</p>
            {model.conflict && model.form?.fingerprint === model.fingerprint ? (
              <>
                <p class='mt-2'>
                  Your text is kept below. Keep it as a new note to preserve both versions.
                </p>
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={model.pending}
                  onClick={controller.keepAsNew}
                >
                  Keep as new note
                </Button>
              </>
            ) : null}
            <Button variant='ghost' size='sm' disabled={model.pending} onClick={controller.reload}>
              Refresh notes
            </Button>
          </div>
        ) : null}
        {model.drafts.length && !model.form ? (
          <DropdownMenu
            trigger={
              <Button variant='outline' class='mb-3'>
                Recover note
              </Button>
            }
            items={model.drafts.flatMap((draft) => [
              ...(draft.version === model.fingerprint
                ? [
                    {
                      kind: 'item' as const,
                      label: new Date(draft.updatedAt).toLocaleString(),
                      disabled: model.pending,
                      onSelect: () => controller.restore(draft),
                    },
                  ]
                : []),
              {
                kind: 'item' as const,
                label: `Discard ${new Date(draft.updatedAt).toLocaleString()}`,
                disabled: model.pending,
                onSelect: () => controller.discardDraft(draft),
              },
            ])}
          />
        ) : null}
        {model.form ? (
          <form
            class='space-y-3'
            use={domBinding(null, focusForm)}
            onSubmit={(event) => {
              event.preventDefault()
              controller.save()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                controller.cancel()
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                event.stopPropagation()
                controller.save()
              }
            }}
          >
            <label class='block space-y-1 text-xs'>
              <span>Title</span>
              <Input
                class='w-full'
                autofocus
                maxLength={200}
                required
                disabled={model.pending}
                value={model.form.label}
                onInput={(event) => controller.change({ label: event.currentTarget.value })}
              />
            </label>
            {model.form.quote ? (
              <blockquote class='max-h-40 overflow-auto border-l-2 border-amber-500/60 pl-2 text-xs leading-relaxed text-muted-foreground'>
                {model.form.quote}
              </blockquote>
            ) : null}
            <label class='block space-y-1 text-xs'>
              <span>Note</span>
              <Textarea
                class='min-h-28 resize-y'
                maxLength={32768}
                disabled={model.pending}
                value={model.form.note}
                onInput={(event) => controller.change({ note: event.currentTarget.value })}
              />
            </label>
            {model.draftError ? (
              <p role='alert' class='text-xs text-amber-300'>
                {model.draftError}
              </p>
            ) : null}
            <div class='flex justify-end gap-2'>
              <Button
                variant='ghost'
                type='button'
                size='sm'
                disabled={model.pending}
                onClick={controller.cancel}
              >
                Cancel
              </Button>
              <Button
                variant='default'
                type='submit'
                disabled={model.pending || !model.form.label.trim()}
              >
                {model.pending ? 'Saving…' : 'Save note'}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div class='mb-3 flex items-center justify-between gap-2'>
              <Button
                variant='outline'
                disabled={model.loading || model.pending || !model.fingerprint}
                onClick={() => controller.create()}
              >
                Bookmark this location
              </Button>
              {model.items.length ? (
                <BrowserDownload>
                  <DropdownMenu
                    aria-label='Notes actions'
                    trigger={
                      <Button variant='ghost' size='icon' aria-label='Notes actions'>
                        <Ellipsis />
                      </Button>
                    }
                    items={[
                      {
                        kind: 'item',
                        label: 'Export notes',
                        disabled: model.pending,
                        onSelect: () => controller.export(),
                      },
                    ]}
                  />
                </BrowserDownload>
              ) : null}
            </div>
            {model.items.length > 3 ? (
              <Input
                type='search'
                aria-label='Filter reading notes'
                class='mb-3'
                placeholder='Filter notes'
                value={model.filter}
                onInput={(event) => controller.filter(event.currentTarget.value)}
              />
            ) : null}
            {model.loading && !model.items.length ? (
              <p role='status' class='py-3 text-xs text-muted-foreground'>
                Loading notes…
              </p>
            ) : null}
            <ol class='space-y-3'>
              {list(
                matches.slice(0, model.limit),
                (entry) => entry.id,
                (entry) => (
                  <li class='rounded-lg border border-border p-2'>
                    <div class='flex items-start gap-1'>
                      <Button
                        variant='ghost'
                        class='h-auto min-w-0 flex-1 justify-start whitespace-normal text-left'
                        disabled={entry.fingerprint !== model.fingerprint}
                        onClick={() => controller.navigate(entry)}
                      >
                        {entry.label}
                      </Button>
                      <div class='shrink-0'>
                        <DropdownMenu
                          trigger={
                            <Button
                              variant='ghost'
                              size='icon-sm'
                              aria-label={`Actions for ${entry.label}`}
                            >
                              <Ellipsis size={16} />
                            </Button>
                          }
                          items={[
                            {
                              kind: 'item',
                              label: 'Edit',
                              disabled: model.pending,
                              onSelect: () => controller.edit(entry),
                            },
                            {
                              kind: 'item',
                              label: 'Delete',
                              variant: 'destructive',
                              disabled: model.pending,
                              onSelect: () => controller.confirmDelete(entry.id),
                            },
                          ]}
                        />
                      </div>
                    </div>
                    {entry.fingerprint !== model.fingerprint ? (
                      <p class='mt-1 text-xs text-amber-300'>
                        Earlier document version · location unavailable
                      </p>
                    ) : null}
                    {entry.quote ? (
                      <blockquote class='mt-2 max-h-32 overflow-auto border-l-2 border-amber-500/60 pl-2 text-xs leading-relaxed text-muted-foreground'>
                        {entry.quote}
                      </blockquote>
                    ) : null}
                    {entry.note ? (
                      <p class='mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed'>
                        {entry.note}
                      </p>
                    ) : null}

                    {model.deleteId === entry.id ? (
                      <div role='alert' class='border-t border-border pt-2 text-xs'>
                        <p>Delete this saved note?</p>
                        <div class='flex justify-end gap-1'>
                          <Button
                            variant='ghost'
                            size='sm'
                            disabled={model.pending}
                            onClick={() => controller.confirmDelete('')}
                          >
                            Keep note
                          </Button>
                          <Button
                            variant='ghost'
                            class='text-destructive'
                            disabled={model.pending}
                            onClick={() => controller.remove(entry)}
                          >
                            Delete note
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ),
              )}
            </ol>
            {matches.length > model.limit ? (
              <Button variant='ghost' class='mt-3 w-full' onClick={controller.more}>
                Show more notes
              </Button>
            ) : null}
            {model.items.length && !matches.length ? (
              <p class='py-3 text-xs text-muted-foreground'>No matching notes</p>
            ) : null}
          </>
        )}
      </section>
    )
  }),
)
