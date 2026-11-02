import { Button } from '@/lib/ui/button'
import { Dialog } from '@/lib/ui/dialog'
import { list, available, modelOwner, resourceError, view, controllerView } from 'effectweb'
import { AsyncResult } from 'effect/reactivity'
import { groups, queryCache } from '@/lib/api/cache'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import type { FileItem } from '@/lib/files/types'
import type { ModalOverlayScope } from './modal-overlay-scope'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import Folder from '@effectweb/lucide/icons/folder'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import { observeQuery, query } from '@effectweb/query'
type MoveOrCopyMode = 'move' | 'copy' | 'extract'
type MoveToDialogProps = {
  overlayScope?: ModalOverlayScope
  onClose: () => void
  fileName: string
  /** Full logical path. */
  filePath: string
  onConfirm: (destinationDir: string) => void
  isPending: boolean
  error: Error | null | undefined
  editableFolders: readonly string[]
  mode?: MoveOrCopyMode
}
function computeSourceRoot(filePath: string, editableFolders: readonly string[]) {
  const normalized = filePath.replace(/\\/g, '/')
  for (const folder of editableFolders) {
    const nf = folder.replace(/\\/g, '/')
    if (nf === '' || normalized === nf || normalized.startsWith(nf + '/')) return nf
  }
  return editableFolders[0]?.replace(/\\/g, '/') || ''
}
function computeInitialBrowse(filePath: string, editableFolders: readonly string[]) {
  const root = computeSourceRoot(filePath, editableFolders)
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  const dir = parts.slice(0, -1).join('/').replace(/\\/g, '/')
  if (root === '' || dir === root || dir.startsWith(root + '/')) return dir
  return root
}
const destinationQuery = query({
  name: 'destination-folders',
  groups: [groups.files],
  load: (path: string) => fetchDirectoryFilesEffect(path),
})
export const MoveToDialog = controllerView(
  {
    controller: (props: MoveToDialogProps) => {
      const owner = modelOwner({
        props,
        selectedRoot: computeSourceRoot(props.filePath, props.editableFolders),
        browsePath: computeInitialBrowse(props.filePath, props.editableFolders),
        result: AsyncResult.initial<{ files: FileItem[] }, Error>(),
      })
      const observer = observeQuery(owner, queryCache, destinationQuery, 'result')
      const browse = (path: string) => {
        owner.patch({ browsePath: path })
        observer.select(path)
      }
      const actions = {
        browse,
        chooseRoot: (path: string) => {
          owner.patch({ selectedRoot: path })
          browse(path)
        },
      }
      observer.select(owner.read().browsePath)
      return {
        source: owner.source,
        ...actions,
        receive: (next: MoveToDialogProps) => owner.patch({ props: next }),
        lifetime: owner,
      }
    },
  },
  view((model) => {
    const props = model.props
    const selectedRoot = model.selectedRoot
    const browsePath = model.browsePath
    const setBrowsePath = model.actions.browse
    const setSelectedRoot = model.actions.chooseRoot
    const isExtract = () => props.mode === 'extract'
    const isCopy = () => (props.mode ?? 'move') === 'copy'
    const files = available(model.result)?.files ?? []
    const error = resourceError(model.result)
    const loading = model.result.waiting && !available(model.result)
    const sourceDir = () => {
      const fp = props.filePath.replace(/\\/g, '/')
      const parts = fp.split(/[/\\]/).filter(Boolean)
      return parts.slice(0, -1).join('/')
    }
    const normalizedBrowse = () => browsePath.replace(/\\/g, '/')
    const normalizedRoot = () => selectedRoot.replace(/\\/g, '/')
    const folders = () => {
      const rawFiles = files
      const normalizedFilePath = props.filePath.replace(/\\/g, '/')
      return rawFiles
        .filter((f) => f.isDirectory && !f.isVirtual)
        .map((f) => {
          const navPath = f.path.replace(/\\/g, '/')
          return { name: f.name, navPath }
        })
        .filter((f) => {
          if (f.navPath === normalizedFilePath) return false
          if (f.navPath.startsWith(normalizedFilePath + '/')) return false
          return true
        })
    }
    const canGoUp = () => normalizedBrowse() !== normalizedRoot()
    function goUp() {
      const parts = browsePath.split(/[/\\]/).filter(Boolean)
      setBrowsePath(parts.slice(0, -1).join('/'))
    }
    function handleRootChange(root: string) {
      const normalized = root.replace(/\\/g, '/')
      setSelectedRoot(normalized)
      setBrowsePath(normalized)
    }
    const isSameAsSource = () => normalizedBrowse() === sourceDir()
    const displayPath = () => {
      if (normalizedBrowse() === normalizedRoot()) return '/'
      const offset = normalizedRoot() ? normalizedRoot().length + 1 : 0
      return '/' + normalizedBrowse().slice(offset)
    }
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !props.isPending) props.onClose()
        }}
        title={`${isExtract() ? 'Extract' : isCopy() ? 'Copy' : 'Move'} ${props.fileName}`}
        class='sm:max-w-lg max-h-[85dvh] overflow-y-auto'
        footer={
          <>
            <Button
              variant='outline'
              type='button'
              disabled={props.isPending}
              onClick={() => {
                if (!props.isPending) props.onClose()
              }}
            >
              Cancel
            </Button>
            <Button
              variant='default'
              type='button'
              disabled={(!isExtract() && isSameAsSource()) || props.isPending}
              onClick={() => props.onConfirm(browsePath)}
            >
              {isExtract()
                ? props.isPending
                  ? 'Starting…'
                  : 'Extract here'
                : props.isPending
                  ? isCopy()
                    ? 'Copying...'
                    : 'Moving...'
                  : isCopy()
                    ? 'Copy here'
                    : 'Move here'}
            </Button>
          </>
        }
      >
        {props.editableFolders.length > 1 ? (
          <div class='flex gap-1.5 flex-wrap mt-3'>
            {list(
              props.editableFolders,
              (folder) => folder,
              (folder) => {
                const nf = folder.replace(/\\/g, '/')
                return (
                  <Button
                    variant={selectedRoot === nf ? 'default' : 'outline'}
                    type='button'
                    class='h-7 px-2 text-xs'
                    onClick={() => handleRootChange(folder)}
                  >
                    {folder || 'Library'}
                  </Button>
                )
              },
            )}
          </div>
        ) : null}

        <div class='flex items-center gap-1.5 text-sm text-muted-foreground px-1'>
          <Folder class='h-3.5 w-3.5 shrink-0' stroke-width={2} />
          <span class='font-mono text-xs truncate'>{displayPath()}</span>
        </div>

        <div class='border border-border rounded-md max-h-64 overflow-y-auto'>
          {!error ? (
            !loading ? (
              <div class='divide-y divide-border'>
                {canGoUp() ? (
                  <Button
                    variant='ghost'
                    type='button'
                    class='flex items-center gap-2.5 w-full px-3 py-2 hover:bg-muted/50 justify-start text-left transition-colors'
                    onClick={() => goUp()}
                  >
                    <ArrowUp class='size-4 text-muted-foreground shrink-0' stroke-width={2} />
                    <span class='text-sm font-medium'>..</span>
                  </Button>
                ) : null}
                {folders().length === 0 && !canGoUp() ? (
                  <div class='px-3 py-8 text-center text-sm text-muted-foreground'>
                    No subfolders
                  </div>
                ) : null}
                {list(
                  folders(),
                  (folder) => folder.navPath,
                  (folder) => (
                    <Button
                      variant='ghost'
                      type='button'
                      class='flex items-center gap-2.5 w-full px-3 py-2 hover:bg-muted/50 justify-start text-left transition-colors'
                      onClick={() => setBrowsePath(folder.navPath)}
                    >
                      <Folder class='size-4 text-muted-foreground shrink-0' stroke-width={2} />
                      <span class='text-sm truncate'>{folder.name}</span>
                    </Button>
                  ),
                )}
              </div>
            ) : (
              <div
                role='status'
                aria-label='Loading folders'
                class='flex items-center justify-center py-8'
              >
                <LoaderCircle class='h-5 w-5 animate-spin text-muted-foreground' stroke-width={2} />
              </div>
            )
          ) : (
            <div class='px-3 py-6 text-center text-sm text-destructive'>{error}</div>
          )}
        </div>

        {props.error ? (
          <p class='mt-3 text-sm text-destructive rounded-md bg-destructive/10 border border-destructive/50 px-3 py-2'>
            {props.error?.message}
          </p>
        ) : null}
      </Dialog>
    )
  }),
)
