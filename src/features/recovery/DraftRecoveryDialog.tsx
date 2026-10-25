import { controllerView, list, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { SaveFileDialog } from '@/features/explorer/SaveFileDialog'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import { draftKindLabel, recoveredFileName } from '@/lib/editor/draft-export'
import { fileNameFromPath, isPathEditable, parentPath } from '@/lib/files/path-utils'
import { draftRecoveryController } from './draft-recovery-controller'
const button =
  'min-h-9 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40'
export default controllerView(
  { controller: draftRecoveryController },
  view((model) => {
    const { actions, props, draft } = model
    const matches = model.items.filter((item) =>
      `${item.path} ${draftKindLabel(item.kind)}`
        .toLocaleLowerCase()
        .includes(model.filter.toLocaleLowerCase()),
    )
    const directory =
      draft && isPathEditable(parentPath(draft.path), [...props.editableFolders])
        ? parentPath(draft.path)
        : (props.editableFolders[0] ?? '')
    const suggestedPath = draft
      ? `${directory ? `${directory}/` : ''}${recoveredFileName(draft)}`
      : ''
    return (
      <div class={modalDialogBackdropClass()} data-no-window-drag>
        <section
          role='dialog'
          aria-modal='true'
          aria-label='Local drafts'
          use={modalFocus({ onEscape: actions.close, ignoreEscape: () => model.saveDialog })}
          class='flex max-h-full w-full max-w-4xl flex-col rounded-xl border border-border bg-background text-foreground shadow-xl'
        >
          <div inert={model.saveDialog} class='flex min-h-0 flex-1 flex-col'>
            <header class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3'>
              <h2 class='min-w-20 flex-1 text-base font-semibold'>Local drafts</h2>
              <button class={button} disabled={model.pending} onClick={actions.reload}>
                Refresh
              </button>
              <button class={button} disabled={model.pending} onClick={actions.close} autofocus>
                Close
              </button>
            </header>
            <p class='shrink-0 px-3 pt-3 text-xs leading-relaxed text-muted-foreground'>
              Backups saved in this browser, including work whose original file was moved or
              deleted. Download or save a recovered copy before discarding a backup.
            </p>
            {model.error ? (
              <p
                role='alert'
                class='mx-3 mt-2 rounded border border-destructive/50 p-2 text-sm text-destructive'
              >
                {model.error}
              </p>
            ) : null}
            {model.message ? (
              <p role='status' class='mx-3 mt-2 rounded border border-border p-2 text-sm'>
                {model.message}
              </p>
            ) : null}
            {model.changed ? (
              <p class='px-3 pt-2 text-xs text-amber-600 dark:text-amber-300'>
                Backups changed in another view. Refresh the list and select a backup to load its
                latest version.
              </p>
            ) : null}
            <div
              class='flex min-h-0 flex-1 flex-col overflow-auto p-3 sm:flex-row sm:gap-3'
              style={{ height: 'min(65vh, 640px)' }}
            >
              <div class='flex min-h-32 shrink-0 flex-col sm:w-64 sm:shrink'>
                <input
                  aria-label='Filter local drafts'
                  type='search'
                  placeholder='Filter by file or kind'
                  class='mb-2 w-full rounded border border-input bg-background px-2 py-1.5 text-sm'
                  value={model.filter}
                  onInput={(event) => actions.filter(event.currentTarget.value)}
                />
                {model.loading ? (
                  <p role='status' class='p-2 text-sm text-muted-foreground'>
                    Loading backups…
                  </p>
                ) : null}
                {!model.loading && !matches.length ? (
                  <p class='p-2 text-sm text-muted-foreground'>
                    {model.items.length ? 'No matching backups.' : 'No local drafts to recover.'}
                  </p>
                ) : null}
                <ul class='max-h-44 min-h-0 space-y-1 overflow-auto sm:max-h-none sm:flex-1'>
                  {list(
                    matches.slice(0, model.limit),
                    (item) => item.id,
                    (item) => (
                      <li>
                        <button
                          class='w-full rounded-lg border border-transparent p-2 text-left hover:bg-accent aria-pressed:border-border aria-pressed:bg-accent disabled:opacity-50'
                          aria-pressed={draft?.id === item.id}
                          disabled={model.pending}
                          onClick={() => actions.select(item.id)}
                        >
                          <span class='block truncate text-sm font-medium'>
                            {fileNameFromPath(item.path)}
                          </span>
                          <span
                            class='block truncate text-xs text-muted-foreground'
                            title={item.path}
                          >
                            {item.path}
                          </span>
                          <span class='block text-[11px] text-muted-foreground'>
                            {draftKindLabel(item.kind)} ·{' '}
                            {new Date(item.updatedAt).toLocaleString()}
                          </span>
                        </button>
                      </li>
                    ),
                  )}
                  {matches.length > model.limit ? (
                    <li>
                      <button class={`${button} w-full`} onClick={actions.more}>
                        Show more backups
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>
              <div class='mt-3 flex min-h-40 min-w-0 flex-1 flex-col rounded-lg border border-border sm:mt-0'>
                {model.selecting ? (
                  <p role='status' class='p-3 text-sm'>
                    Loading backup…
                  </p>
                ) : !draft ? (
                  <p class='p-3 text-sm text-muted-foreground'>
                    Choose a backup to preview and recover it.
                  </p>
                ) : (
                  <>
                    <div class='shrink-0 border-b border-border p-3'>
                      <h3 class='break-all text-sm font-semibold'>{draft.path}</h3>
                      <p class='mt-1 text-xs text-muted-foreground'>
                        {draftKindLabel(draft.kind)} · {new Date(draft.updatedAt).toLocaleString()}
                      </p>
                      {draft.kind === 'pdf' ? (
                        <p class='mt-1 text-xs text-muted-foreground'>
                          This backup contains form field values. Reopen the matching original PDF
                          to restore them, or export the values as JSON.
                        </p>
                      ) : null}
                    </div>
                    {model.previewError ? (
                      <div class='p-3'>
                        <p role='alert' class='text-sm text-destructive'>
                          {model.previewError}
                        </p>
                        <div class='mt-2 flex flex-wrap gap-2'>
                          <button
                            class={button}
                            disabled={model.pending}
                            onClick={actions.downloadRaw}
                          >
                            Download backup data
                          </button>
                          {draft.attachment ? (
                            <button
                              class={button}
                              disabled={model.pending}
                              onClick={actions.downloadSource}
                            >
                              Download source image
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {draft.kind === 'image' ? (
                      <div class='grid min-h-24 flex-1 place-items-center overflow-auto p-3'>
                        {model.previewUrl ? (
                          <img
                            class='max-h-64 max-w-full object-contain'
                            src={model.previewUrl}
                            alt='Recovered image preview'
                          />
                        ) : !model.previewError ? (
                          <p role='status' class='text-sm'>
                            Preparing image preview…
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <pre
                        aria-label='Draft preview'
                        class='min-h-20 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words'
                      >
                        {model.preview}
                      </pre>
                    )}
                    {model.preview.length >= 20_000 ? (
                      <p class='px-3 text-xs text-muted-foreground'>
                        Preview shows the first 20,000 characters. Downloads and saved copies
                        contain the full draft.
                      </p>
                    ) : null}
                    <div class='flex shrink-0 flex-wrap gap-2 border-t border-border p-2'>
                      <button
                        class={button}
                        disabled={model.pending}
                        onClick={actions.openOriginal}
                      >
                        Open original
                      </button>
                      <button
                        class={button}
                        disabled={model.pending || !!model.previewError}
                        onClick={() => actions.download()}
                      >
                        {draft.kind === 'pdf' ? 'Download values' : 'Download draft'}
                      </button>
                      {props.editableFolders.length ? (
                        <button
                          class={button}
                          disabled={model.pending || !!model.previewError}
                          onClick={actions.openSave}
                        >
                          Save copy…
                        </button>
                      ) : null}
                      <button
                        class={`${button} ml-auto text-destructive`}
                        disabled={model.pending}
                        onClick={() => actions.confirmDiscard(true)}
                      >
                        Discard…
                      </button>
                    </div>
                    {model.discard ? (
                      <div role='alert' class='border-t border-border p-3 text-sm'>
                        <p>
                          Remove this browser backup? Saved files stay unchanged. An open editor may
                          create a new backup when its work changes or closes.
                        </p>
                        <div class='mt-2 flex justify-end gap-2'>
                          <button
                            class={button}
                            disabled={model.pending}
                            onClick={() => actions.confirmDiscard(false)}
                          >
                            Keep backup
                          </button>
                          <button
                            class={`${button} text-destructive`}
                            disabled={model.pending}
                            onClick={actions.discard}
                          >
                            Discard backup
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
          {model.saveDialog && draft ? (
            <SaveFileDialog
              title='Save recovered copy'
              suggestedPath={suggestedPath}
              editableFolders={props.editableFolders}
              pending={model.pending}
              error={model.error}
              onConfirm={actions.saveCopy}
              onDownload={(name) => actions.download(name)}
              onClose={actions.closeSave}
              description='Save a new file. Existing files and the browser backup are kept.'
            />
          ) : null}
        </section>
      </div>
    )
  }),
)
