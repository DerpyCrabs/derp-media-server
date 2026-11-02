import { SaveFileDialog } from './SaveFileDialog'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { Button } from '@/lib/ui/button'
import type { FileItem } from '@/lib/files/types'
import { list, view } from 'effectweb'
import { Dialog } from '@/lib/ui/dialog'
import { formatFileSize } from '@/lib/media/media-utils'
import { isPathEditable } from '@/lib/files/path-utils'
import type { FileTools } from './file-tools-controller'
import type { FileBrowserHost } from './FileBrowser'
import { fileJobs } from './file-jobs'
import { FileOperationRow } from './FileOperationRow'
import { MoveToDialog } from './MoveToDialog'
export const FileToolsPanel = view<{
  tools: FileTools
  state: ReturnType<FileTools['read']>
  host: FileBrowserHost
  files: readonly FileItem[]
}>((props) => {
  const { tools, state, host } = props
  const close = () => tools.open(null)
  const visibleJobs = state.jobs.jobs.filter(
    (job) => fileJobs.active(job) || job.errors.length > 0 || job.status === 'failed',
  )
  const selected = state.selected
  const writable =
    selected.length > 0 &&
    selected.every((path) => isPathEditable(path, host.editableFolders, host.mediaRoots))
  const scope = host.layout === 'workspace' ? 'window' : 'viewport'
  if (!state.panel || state.panel === 'location') return null
  if (state.panel === 'copy' || state.panel === 'move')
    return (
      <MoveToDialog
        overlayScope={scope}
        mode={state.panel === 'move' ? 'move' : 'copy'}
        fileName={selected.length === 1 ? fileNameFromPath(selected[0]!) : 'files'}
        filePath={selected[0] ?? ''}
        editableFolders={host.editableFolders}
        onClose={close}
        onConfirm={(path) => tools.start(state.panel === 'move' ? 'move' : 'copy', path)}
        isPending={state.jobs.pending}
        error={state.jobs.error ? new Error(state.jobs.error) : undefined}
      />
    )
  if (state.panel === 'createArchive')
    return (
      <SaveFileDialog
        title='Create archive'
        confirmLabel='Create archive'
        suggestedPath={state.path ? `${state.path}/${state.name}` : state.name}
        editableFolders={host.editableFolders}
        pending={state.jobs.pending}
        error={state.jobs.error || undefined}
        onClose={close}
        onConfirm={(path) => {
          tools.patch({ name: fileNameFromPath(path) })
          tools.start('createArchive', parentPath(path))
        }}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title={
        (
          {
            location: 'Go to location',
            properties: 'Properties',
            createArchive: 'Create archive',
            operations: 'File operations',
            delete:
              state.trashAvailable && !state.permanentDelete ? 'Move to trash' : 'Delete files',
            trash: 'Trash',
          } as Record<string, string>
        )[state.panel] ?? 'Files'
      }
      class='sm:max-w-xl max-h-[85dvh] overflow-y-auto'
      footer={
        state.panel === 'delete' ? (
          <>
            <Button variant='outline' onClick={close}>
              Cancel
            </Button>
            <Button
              variant={state.trashAvailable && !state.permanentDelete ? 'default' : 'destructive'}
              disabled={!writable || state.jobs.pending}
              onClick={() =>
                tools.start(state.trashAvailable && !state.permanentDelete ? 'trash' : 'delete')
              }
            >
              {state.trashAvailable && !state.permanentDelete
                ? 'Move to trash'
                : 'Delete permanently'}
            </Button>
          </>
        ) : undefined
      }
    >
      {state.panel === 'properties' ? (
        state.properties ? (
          <div class='space-y-5'>
            <div>
              <p class='break-words text-lg font-semibold'>
                {state.properties.path.split('/').pop() || '/'}
              </p>
              <p class='mt-1 text-sm text-muted-foreground'>
                {state.properties.directory ? 'Folder' : formatFileSize(state.properties.size)}
              </p>
            </div>
            <dl class='grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 border-t border-border pt-4 text-sm'>
              <dt class='text-muted-foreground'>Location</dt>
              <dd class='break-all select-text'>{state.properties.path}</dd>
              <dt class='text-muted-foreground'>Modified</dt>
              <dd>
                {state.properties.modified
                  ? new Date(state.properties.modified).toLocaleString()
                  : '—'}
              </dd>
              <dt class='text-muted-foreground'>Access</dt>
              <dd>
                {state.properties.editable ? 'Read and write' : 'Read only'}
                <span class='ml-2 font-mono text-xs text-muted-foreground'>
                  {state.properties.permissions}
                </span>
              </dd>
            </dl>
          </div>
        ) : (
          <p>Loading properties…</p>
        )
      ) : null}
      {state.panel === 'delete' ? (
        <div class='space-y-3'>
          <ul class='max-h-48 overflow-auto space-y-3 text-sm'>
            {list(
              selected,
              (path) => path,
              (path) => (
                <li title={path}>
                  <p class='break-words font-medium'>{fileNameFromPath(path)}</p>
                  {parentPath(path) ? (
                    <p class='break-all text-xs text-muted-foreground'>{parentPath(path)}</p>
                  ) : null}
                </li>
              ),
            )}
          </ul>
          {!state.trashAvailable || state.permanentDelete ? (
            <p class='text-sm text-muted-foreground'>This cannot be undone.</p>
          ) : null}
        </div>
      ) : null}
      {state.panel === 'trash' ? (
        <div class='space-y-3'>
          <p role='status' class='break-words text-sm'>
            {state.trashNotice}
          </p>
          {!state.trashEntries ? (
            <p>Loading trash…</p>
          ) : !state.trashEntries.length ? (
            <p>Trash is empty.</p>
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
                    <Button
                      variant='outline'
                      disabled={state.pending || !item.editable}
                      title={
                        item.editable ? `Restore ${item.name}` : 'Original folder is read-only'
                      }
                      onClick={() => tools.restoreTrash(item.id)}
                    >
                      Restore
                    </Button>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ) : null}
      {state.panel === 'operations' ? (
        <div class='divide-y divide-border'>
          {state.jobs.pending ? <p class='py-3 text-sm text-muted-foreground'>Starting…</p> : null}
          {!visibleJobs.length && !state.jobs.pending ? (
            <p class='py-6 text-center text-sm text-muted-foreground'>No file operations</p>
          ) : null}
          {list(
            visibleJobs,
            (job) => job.id,
            (job) => (
              <FileOperationRow job={job} />
            ),
          )}
        </div>
      ) : null}
      {state.error || state.jobs.error ? (
        <p role='alert' class='mt-3 text-sm text-destructive'>
          {state.error || state.jobs.error}
        </p>
      ) : null}
    </Dialog>
  )
})
