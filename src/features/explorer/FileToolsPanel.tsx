import type { FileItem } from '@/lib/files/types'
import { list, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { isPathEditable } from '@/lib/files/path-utils'
import { runDesktopOperation } from '@/desktop/operations'
import { modalDialogBackdropClass } from './modal-overlay-scope'
import type { FileTools } from './file-tools-controller'
import type { FileBrowserHost } from './FileBrowser'
import { fileJobs } from './file-jobs'
import { MoveToDialog } from './MoveToDialog'
const button =
  'rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-40'
const input = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
export const FileToolsPanel = view<{
  tools: FileTools
  state: ReturnType<FileTools['read']>
  host: FileBrowserHost
  files: readonly FileItem[]
}>((props) => {
  const { tools, state, host } = props
  const close = () => tools.open(null)
  const selected = state.selected
  const writable =
    selected.length > 0 &&
    selected.every((path) => isPathEditable(path, host.editableFolders, host.mediaRoots))
  const editable = isPathEditable(host.currentPath, host.editableFolders, host.mediaRoots)
  const scope = host.layout === 'workspace' ? 'window' : 'viewport'
  if (!state.panel) return null
  if (state.panel === 'copy' || state.panel === 'move' || state.panel === 'extractArchive')
    return (
      <MoveToDialog
        overlayScope={scope}
        mode={state.panel === 'move' ? 'move' : 'copy'}
        fileName={`${selected.length} selected item(s)`}
        filePath={selected[0] ?? ''}
        editableFolders={host.editableFolders}
        onClose={close}
        onConfirm={(path) =>
          tools.start(
            state.panel === 'move'
              ? 'move'
              : state.panel === 'extractArchive'
                ? 'extractArchive'
                : 'copy',
            path,
          )
        }
        isPending={state.jobs.pending}
        error={state.jobs.error ? new Error(state.jobs.error) : undefined}
      />
    )
  return (
    <div
      data-no-window-drag
      class={modalDialogBackdropClass(scope)}
      role='presentation'
      onClick={close}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label='File tools'
        use={modalFocus({ onEscape: close })}
        class='max-h-[calc(100%-1rem)] w-full max-w-xl overflow-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg'
        onClick={(event) => event.stopPropagation()}
      >
        <div class='mb-4 flex items-center justify-between'>
          <h2 class='text-lg font-semibold'>
            {(
              {
                menu: 'Files',
                location: 'Go to location',
                properties: 'Properties',
                archive: 'Archive contents',
                createArchive: 'Create ZIP',
                operations: 'File operations',
                delete:
                  state.trashAvailable && !state.permanentDelete ? 'Move to trash' : 'Delete files',
                trash: 'Trash',
              } as Record<string, string>
            )[state.panel] ?? 'Files'}
          </h2>
          <button class={button} onClick={close}>
            Close
          </button>
        </div>
        {state.panel === 'menu' ? (
          <div class='space-y-4'>
            <p class='text-sm text-muted-foreground'>
              {selected.length} selected · Ctrl/Cmd-click adds items; Shift-click selects a range.
            </p>
            <div class='flex flex-wrap gap-2'>
              <button
                class={button}
                onClick={() => {
                  tools.selectMode()
                  close()
                }}
              >
                {state.selecting ? 'End selection' : 'Select files'}
              </button>
              <button
                class={button}
                onClick={() => {
                  tools.selectAll()
                  close()
                }}
              >
                Select all
              </button>
              <button class={button} disabled={!selected.length} onClick={tools.clear}>
                Clear selection
              </button>
              <button class={button} onClick={tools.openFilter}>
                Filter folder
              </button>
              <button class={button} onClick={() => tools.open('location')}>
                Go to location
              </button>
              <button class={button} aria-pressed={state.hidden} onClick={tools.toggleHidden}>
                {state.hidden ? 'Hide hidden files' : 'Show hidden files'}
              </button>
              <button class={button} onClick={() => tools.open('operations')}>
                Operations
              </button>
              <button
                class={button}
                disabled={!editable || (!state.jobs.clipboard && !state.desktop)}
                onClick={tools.paste}
              >
                Paste
              </button>
            </div>
            {selected.length ? (
              <div class='flex flex-wrap gap-2 border-t border-border pt-4'>
                <button
                  class={button}
                  disabled={!selected.length || !host.editableFolders.length}
                  onClick={() => tools.open('copy')}
                >
                  Copy to…
                </button>
                <button class={button} disabled={!writable} onClick={() => tools.open('move')}>
                  Move to…
                </button>
                <button
                  class={button}
                  disabled={!selected.length}
                  onClick={() => {
                    tools.copy(false)
                    close()
                  }}
                >
                  Copy
                </button>
                <button
                  class={button}
                  disabled={!writable}
                  onClick={() => {
                    tools.copy(true)
                    close()
                  }}
                >
                  Cut
                </button>
                <button class={button} disabled={!writable} onClick={() => tools.open('delete')}>
                  {state.trashAvailable ? 'Move to trash…' : 'Delete…'}
                </button>
                {selected.length === 1 &&
                props.files.some(
                  (file) => file.path === selected[0] && !file.isDirectory && !file.isVirtual,
                ) ? (
                  <button class={button} onClick={() => tools.preview(selected[0]!)}>
                    Quick preview
                  </button>
                ) : null}
                <button
                  class={button}
                  disabled={selected.length !== 1}
                  onClick={() => tools.open('properties')}
                >
                  Properties
                </button>
                <button
                  class={button}
                  disabled={selected.length !== 1 || !selected[0]?.toLowerCase().endsWith('.zip')}
                  onClick={() => tools.open('archive')}
                >
                  Browse ZIP
                </button>
                <button
                  class={button}
                  disabled={!selected.length || !host.editableFolders.length}
                  onClick={() => tools.open('createArchive')}
                >
                  Create ZIP…
                </button>
              </div>
            ) : null}
            {state.desktop ? (
              <div class='flex flex-wrap gap-2'>
                <button
                  class={button}
                  onClick={() =>
                    runDesktopOperation(() => window.derpDesktop!.terminal!(host.currentPath))
                  }
                >
                  Open terminal here
                </button>
                <button
                  class={button}
                  disabled={selected.length !== 1}
                  onClick={() => tools.showApplications()}
                >
                  Open with…
                </button>
                {list(
                  state.applications,
                  (app) => app.id,
                  (app) => (
                    <button
                      class={button}
                      onClick={() =>
                        runDesktopOperation(() =>
                          window.derpDesktop!.openWith!(selected[0]!, app.id),
                        )
                      }
                    >
                      {app.name}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {state.panel === 'location' ? (
          <form
            class='space-y-3'
            onSubmit={(event) => {
              event.preventDefault()
              tools.navigate()
            }}
          >
            <label class='block text-sm'>
              Location
              <input
                autofocus
                class={input}
                value={state.path}
                onInput={(event) => tools.patch({ path: event.currentTarget.value })}
              />
            </label>
            <p class='text-sm text-muted-foreground'>
              {state.desktopMode
                ? 'Enter a filesystem path, or ~ for your home folder.'
                : 'Use a path inside a configured media root.'}
            </p>
            <button class={button} disabled={state.pending}>
              Go
            </button>
          </form>
        ) : null}
        {state.panel === 'properties' ? (
          state.properties ? (
            <dl class='space-y-2 break-all text-sm'>
              <dt>Path</dt>
              <dd>{state.properties.path}</dd>
              <dt>Type</dt>
              <dd>{state.properties.directory ? 'Folder' : 'File'}</dd>
              <dt>Size</dt>
              <dd>{state.properties.size} bytes</dd>
              <dt>Permissions</dt>
              <dd>
                {state.properties.permissions} ·{' '}
                {state.properties.editable ? 'Editable' : 'Read only in this app'}
              </dd>
              <dt>Modified</dt>
              <dd>
                {state.properties.modified
                  ? new Date(state.properties.modified).toLocaleString()
                  : 'Unknown'}
              </dd>
            </dl>
          ) : (
            <p>Loading properties…</p>
          )
        ) : null}
        {state.panel === 'delete' ? (
          <div class='space-y-4'>
            <p>
              {state.trashAvailable && !state.permanentDelete
                ? `Move ${selected.length} selected item(s) to the system trash? You can restore them from Places → Trash.`
                : `Permanently delete ${selected.length} selected item(s)? This cannot be undone.`}
            </p>
            <button
              class={button}
              disabled={!writable}
              onClick={() =>
                tools.start(state.trashAvailable && !state.permanentDelete ? 'trash' : 'delete')
              }
            >
              {state.trashAvailable && !state.permanentDelete
                ? 'Move to trash'
                : 'Delete permanently'}
            </button>
          </div>
        ) : null}
        {state.panel === 'trash' ? (
          <div class='space-y-3'>
            <div class='flex items-center justify-between gap-3'>
              <p class='text-sm text-muted-foreground'>
                System trash · items from your configured folders
              </p>
              <button
                class={button}
                disabled={state.pending || state.trashLoading}
                onClick={tools.refreshTrash}
              >
                Refresh
              </button>
            </div>
            <p role='status' class='break-words text-sm'>
              {state.trashNotice}
            </p>
            {!state.trashEntries ? (
              <p>Loading trash…</p>
            ) : !state.trashEntries.length ? (
              <p>No deleted items in these folders.</p>
            ) : (
              <div class='divide-y divide-border'>
                {list(
                  state.trashEntries,
                  (item) => item.id,
                  (item) => (
                    <div class='flex items-center gap-3 py-3'>
                      <div class='min-w-0 flex-1'>
                        <p class='truncate text-sm font-medium' title={item.name}>
                          {item.name}
                        </p>
                        <p class='truncate text-xs text-muted-foreground' title={item.path}>
                          {item.path}
                        </p>
                        {item.deletedAt > 0 ? (
                          <p class='text-xs text-muted-foreground'>
                            {new Date(item.deletedAt * 1000).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      <button
                        class={button}
                        disabled={state.pending || !item.editable}
                        title={
                          item.editable ? `Restore ${item.name}` : 'Original folder is read-only'
                        }
                        onClick={() => tools.restoreTrash(item.id)}
                      >
                        Restore
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ) : null}
        {state.panel === 'createArchive' ? (
          <form
            class='space-y-3'
            onSubmit={(event) => {
              event.preventDefault()
              tools.start('createArchive')
            }}
          >
            <label class='block'>
              ZIP filename
              <input
                class={input}
                value={state.name}
                onInput={(event) => tools.patch({ name: event.currentTarget.value })}
              />
            </label>
            <label class='block'>
              Destination folder
              <input
                class={input}
                value={state.path}
                onInput={(event) => tools.patch({ path: event.currentTarget.value })}
              />
            </label>
            <button class={button} disabled={state.jobs.pending}>
              Create ZIP
            </button>
          </form>
        ) : null}
        {state.panel === 'archive' ? (
          <div class='space-y-3'>
            <p>
              {state.archive?.length ?? 0} entries · {state.members.length} selected
            </p>
            <input
              aria-label='Filter archive entries'
              class={input}
              value={state.filter}
              onInput={(event) => tools.patch({ filter: event.currentTarget.value })}
            />
            <div class='max-h-72 overflow-auto'>
              {list(
                (state.archive ?? [])
                  .filter((entry) => entry.path.includes(state.filter))
                  .slice(0, 1000),
                (entry) => entry.path,
                (entry) => (
                  <label class='flex gap-2 py-1 text-sm'>
                    <input
                      type='checkbox'
                      checked={state.members.includes(entry.path)}
                      onChange={(event) =>
                        tools.patch({
                          members: event.currentTarget.checked
                            ? [...state.members, entry.path]
                            : state.members.filter((path) => path !== entry.path),
                        })
                      }
                    />
                    <span class='break-all'>
                      {entry.path}
                      {entry.directory ? '/' : ''}
                    </span>
                    <span class='ml-auto whitespace-nowrap text-muted-foreground'>
                      {entry.size} B
                    </span>
                  </label>
                ),
              )}
            </div>
            <p class='text-xs text-muted-foreground'>
              Showing up to 1,000 matching entries. Filter to find more.
            </p>
            <button
              class={button}
              disabled={!state.archive?.length || !host.editableFolders.length}
              onClick={() => tools.open('extractArchive')}
            >
              {state.members.length ? 'Extract selected…' : 'Extract all…'}
            </button>
          </div>
        ) : null}
        {state.panel === 'operations' ? (
          <div class='space-y-4'>
            <p class='text-sm text-muted-foreground'>
              Operations continue when this panel is closed. Cancellation keeps items already
              completed.
            </p>
            {state.jobs.pending ? <p>Starting…</p> : null}
            {!state.jobs.jobs.length ? <p>No operations yet.</p> : null}
            {list(
              state.jobs.jobs,
              (job) => job.id,
              (job) => (
                <article class='space-y-2 rounded border border-border p-3 text-sm'>
                  <p class='font-medium'>
                    {job.operation} · {job.status}
                  </p>
                  <p>
                    {job.completed}/{job.total} processed · {job.skipped} skipped · {job.bytes}{' '}
                    bytes transferred
                  </p>
                  <p class='break-all text-muted-foreground'>{job.current}</p>
                  {fileJobs.active(job) ? (
                    <button class={button} onClick={() => fileJobs.cancel(job.id)}>
                      Cancel operation
                    </button>
                  ) : null}
                  {job.conflict ? (
                    <div class='space-y-2'>
                      <p class='break-all'>Already exists: {job.conflict}</p>
                      <label class='flex gap-2'>
                        <input
                          type='checkbox'
                          checked={state.applyAll}
                          onChange={(event) =>
                            tools.patch({ applyAll: event.currentTarget.checked })
                          }
                        />
                        Apply to remaining conflicts
                      </label>
                      <div class='flex gap-2'>
                        <button
                          class={button}
                          onClick={() => fileJobs.decide(job.id, 'skip', state.applyAll)}
                        >
                          Skip
                        </button>
                        <button
                          class={button}
                          onClick={() => fileJobs.decide(job.id, 'replace', state.applyAll)}
                        >
                          Replace
                        </button>
                        <button
                          class={button}
                          onClick={() => fileJobs.decide(job.id, 'keepBoth', state.applyAll)}
                        >
                          Keep both
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {list(
                    job.errors,
                    (error) => error.path,
                    (error) => (
                      <p class='break-all text-destructive'>
                        {error.path}: {error.message}
                      </p>
                    ),
                  )}
                </article>
              ),
            )}
          </div>
        ) : null}
        {state.error || state.jobs.error ? (
          <p role='alert' class='mt-3 text-sm text-destructive'>
            {state.error || state.jobs.error}
          </p>
        ) : null}
      </div>
    </div>
  )
})
