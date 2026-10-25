import { domBinding, list, observe, view } from 'effectweb'
import type { ReaderNotesController } from './reader-notes-controller'
const button = 'min-h-9 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40'
const input =
  'w-full rounded-md border border-[#444] bg-[#202020] px-2 py-2 text-sm text-[#eee] outline-none focus:border-[#888]'
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
      <section aria-label='Reading notes' class='min-h-0 flex-1 overflow-auto p-3 text-[#eee]'>
        {model.error ? (
          <div role='alert' class='mb-3 rounded border border-red-800 p-2 text-xs text-red-200'>
            <p>{model.error}</p>
            {model.conflict && model.form?.fingerprint === model.fingerprint ? (
              <>
                <p class='mt-2'>
                  Your text is kept below. Keep it as a new note to preserve both versions.
                </p>
                <button class={button} disabled={model.pending} onClick={controller.keepAsNew}>
                  Keep as new note
                </button>
              </>
            ) : null}
            <button class={button} disabled={model.pending} onClick={controller.reload}>
              Refresh notes
            </button>
          </div>
        ) : null}
        {model.drafts.length && !model.form ? (
          <div class='mb-3 space-y-2 rounded border border-amber-700/60 p-2 text-xs'>
            <p>Unfinished notes saved in this browser</p>
            {list(
              model.drafts,
              (draft) => draft.id,
              (draft) => (
                <div class='border-t border-white/10 pt-2'>
                  <p class='text-white/60'>
                    {new Date(draft.updatedAt).toLocaleString()}
                    {draft.version !== model.fingerprint ? ' · Earlier document version' : ''}
                  </p>
                  <div class='flex flex-wrap gap-1'>
                    {draft.version === model.fingerprint ? (
                      <button
                        class={button}
                        disabled={model.pending}
                        onClick={() => controller.restore(draft)}
                      >
                        Restore note
                      </button>
                    ) : null}
                    <button
                      class={button}
                      disabled={model.pending}
                      onClick={() => controller.export(draft)}
                    >
                      Download draft
                    </button>
                    <button
                      class={button}
                      disabled={model.pending}
                      onClick={() => controller.discardDraft(draft)}
                    >
                      Discard draft
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
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
              <input
                class={input}
                autofocus
                maxLength={200}
                required
                disabled={model.pending}
                value={model.form.label}
                onInput={(event) => controller.change({ label: event.currentTarget.value })}
              />
            </label>
            {model.form.quote ? (
              <blockquote class='max-h-40 overflow-auto border-l-2 border-amber-500/60 pl-2 text-xs leading-relaxed text-white/75'>
                {model.form.quote}
              </blockquote>
            ) : null}
            <label class='block space-y-1 text-xs'>
              <span>Note</span>
              <textarea
                class={`${input} min-h-28 resize-y`}
                maxLength={32768}
                disabled={model.pending}
                value={model.form.note}
                placeholder='Optional thoughts or context'
                onInput={(event) => controller.change({ note: event.currentTarget.value })}
              />
            </label>
            {model.draftError ? (
              <p role='alert' class='text-xs text-amber-300'>
                {model.draftError}
              </p>
            ) : model.draftSaved ? (
              <p role='status' class='text-xs text-white/50'>
                Draft backed up in this browser
              </p>
            ) : null}
            <div class='flex justify-end gap-2'>
              <button
                type='button'
                class={button}
                disabled={model.pending}
                onClick={controller.cancel}
              >
                Cancel
              </button>
              <button
                class={`${button} bg-white/15`}
                disabled={model.pending || !model.form.label.trim()}
              >
                {model.pending ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div class='mb-3 flex flex-wrap items-center justify-between gap-1'>
              <button
                class={`${button} border border-white/20`}
                disabled={model.loading || model.pending || !model.fingerprint}
                onClick={() => controller.create()}
              >
                Bookmark this location
              </button>
              <button
                class={button}
                disabled={model.pending || !model.items.length}
                onClick={() => controller.export()}
              >
                Export notes
              </button>
            </div>
            {model.items.length > 3 ? (
              <input
                type='search'
                aria-label='Filter reading notes'
                class={`${input} mb-3`}
                placeholder='Filter notes'
                value={model.filter}
                onInput={(event) => controller.filter(event.currentTarget.value)}
              />
            ) : null}
            {model.loading && !model.items.length ? (
              <p role='status' class='py-3 text-xs text-white/60'>
                Loading notes…
              </p>
            ) : null}
            {!model.loading && !model.items.length ? (
              <p class='py-3 text-sm leading-relaxed text-white/60'>
                Bookmark a page or chapter, or select text and choose Save quote.
              </p>
            ) : null}
            <ol class='space-y-3'>
              {list(
                matches.slice(0, model.limit),
                (entry) => entry.id,
                (entry) => (
                  <li class='rounded-lg border border-white/15 p-2'>
                    <button
                      class='w-full rounded text-left text-sm font-medium hover:underline disabled:text-white/50 disabled:no-underline'
                      disabled={entry.fingerprint !== model.fingerprint}
                      onClick={() => controller.navigate(entry)}
                    >
                      {entry.label}
                    </button>
                    {entry.fingerprint !== model.fingerprint ? (
                      <p class='mt-1 text-xs text-amber-300'>
                        Earlier document version · location unavailable
                      </p>
                    ) : null}
                    {entry.quote ? (
                      <blockquote class='mt-2 max-h-32 overflow-auto border-l-2 border-amber-500/60 pl-2 text-xs leading-relaxed text-white/70'>
                        {entry.quote}
                      </blockquote>
                    ) : null}
                    {entry.note ? (
                      <p class='mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed'>
                        {entry.note}
                      </p>
                    ) : null}
                    <div class='mt-1 flex justify-end gap-1'>
                      <button
                        class={button}
                        disabled={model.pending}
                        onClick={() => controller.edit(entry)}
                      >
                        Edit
                      </button>
                      <button
                        class={button}
                        disabled={model.pending}
                        onClick={() => controller.confirmDelete(entry.id)}
                      >
                        Delete
                      </button>
                    </div>
                    {model.deleteId === entry.id ? (
                      <div role='alert' class='border-t border-white/15 pt-2 text-xs'>
                        <p>Delete this saved note?</p>
                        <div class='flex justify-end gap-1'>
                          <button
                            class={button}
                            disabled={model.pending}
                            onClick={() => controller.confirmDelete('')}
                          >
                            Keep note
                          </button>
                          <button
                            class={`${button} text-red-300`}
                            disabled={model.pending}
                            onClick={() => controller.remove(entry)}
                          >
                            Delete note
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ),
              )}
            </ol>
            {matches.length > model.limit ? (
              <button class={`${button} mt-3 w-full`} onClick={controller.more}>
                Show more notes
              </button>
            ) : null}
            {model.items.length && !matches.length ? (
              <p class='py-3 text-xs text-white/60'>No matching notes</p>
            ) : null}
            <p class='mt-4 text-[11px] leading-relaxed text-white/45'>
              Saved with this library. The original document is unchanged.
            </p>
          </>
        )}
      </section>
    )
  }),
)
