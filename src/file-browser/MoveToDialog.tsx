import { api } from '@/lib/api'
import { stripSharePrefix } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import Folder from 'lucide-solid/icons/folder'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'

type MoveOrCopyMode = 'move' | 'copy'

type MoveToDialogProps = {
  onClose: () => void
  fileName: string
  /** Admin: full path. Share: path relative to share root. */
  filePath: string
  onConfirm: (destinationDir: string) => void
  isPending: boolean
  error: Error | null | undefined
  editableFolders: string[]
  mode?: MoveOrCopyMode
  shareToken?: string
  /** Full server path of share root (for stripping API paths). */
  shareRootPath?: string
}

function computeSourceRoot(filePath: string, editableFolders: string[]) {
  const normalized = filePath.replace(/\\/g, '/')
  for (const folder of editableFolders) {
    const nf = folder.replace(/\\/g, '/')
    if (normalized === nf || normalized.startsWith(nf + '/')) return nf
  }
  return editableFolders[0]?.replace(/\\/g, '/') || ''
}

function computeInitialBrowse(filePath: string, editableFolders: string[]) {
  const root = computeSourceRoot(filePath, editableFolders)
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  const dir = parts.slice(0, -1).join('/').replace(/\\/g, '/')
  if (dir === root || dir.startsWith(root + '/')) return dir
  return root
}

function sourceDirRelative(relFilePath: string) {
  const parts = relFilePath.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

export function MoveToDialog(props: MoveToDialogProps) {
  const isCopy = () => (props.mode ?? 'move') === 'copy'
  const isShare = () => !!props.shareToken

  const [selectedRoot, setSelectedRoot] = createSignal(
    isShare() ? '' : computeSourceRoot(props.filePath, props.editableFolders),
  )
  const [browsePath, setBrowsePath] = createSignal(
    isShare()
      ? sourceDirRelative(props.filePath.replace(/\\/g, '/'))
      : computeInitialBrowse(props.filePath, props.editableFolders),
  )

  const listSource = createMemo(() => {
    if (isShare()) {
      return { kind: 'share' as const, token: props.shareToken!, dir: browsePath() }
    }
    return { kind: 'admin' as const, dir: browsePath() }
  })

  const [dirFiles] = createResource(listSource, async (src) => {
    if (src.kind === 'share') {
      const { files } = await api<{ files: FileItem[] }>(
        `/api/share/${src.token}/files?dir=${encodeURIComponent(src.dir)}`,
      )
      return files
    }
    const { files } = await api<{ files: FileItem[] }>(
      `/api/files?dir=${encodeURIComponent(src.dir)}`,
    )
    return files
  })

  const sourceDir = createMemo(() => {
    const fp = props.filePath.replace(/\\/g, '/')
    if (isShare()) {
      return sourceDirRelative(fp)
    }
    const parts = fp.split(/[/\\]/).filter(Boolean)
    return parts.slice(0, -1).join('/')
  })

  const normalizedBrowse = createMemo(() => browsePath().replace(/\\/g, '/'))
  const normalizedRoot = createMemo(() => selectedRoot().replace(/\\/g, '/'))

  const folders = createMemo(() => {
    const rawFiles: FileItem[] = dirFiles() ?? []
    const root = props.shareRootPath?.replace(/\\/g, '/') ?? ''
    const normalizedFilePath = props.filePath.replace(/\\/g, '/')
    return rawFiles
      .filter((f) => f.isDirectory)
      .map((f) => {
        const navPath = isShare() ? stripSharePrefix(f.path, root) : f.path.replace(/\\/g, '/')
        return { name: f.name, navPath }
      })
      .filter((f) => {
        if (f.navPath === normalizedFilePath) return false
        if (f.navPath.startsWith(normalizedFilePath + '/')) return false
        return true
      })
  })

  const canGoUp = createMemo(() =>
    isShare() ? normalizedBrowse() !== '' : normalizedBrowse() !== normalizedRoot(),
  )

  function goUp() {
    const parts = browsePath().split(/[/\\]/).filter(Boolean)
    setBrowsePath(parts.slice(0, -1).join('/'))
  }

  function handleRootChange(root: string) {
    const normalized = root.replace(/\\/g, '/')
    setSelectedRoot(normalized)
    setBrowsePath(normalized)
  }

  const isSameAsSource = createMemo(() => normalizedBrowse() === sourceDir())

  const displayPath = createMemo(() => {
    if (isShare()) {
      return browsePath() ? `/${browsePath()}` : '/'
    }
    if (normalizedBrowse() === normalizedRoot()) return '/'
    return '/' + normalizedBrowse().slice(normalizedRoot().length + 1)
  })

  return (
    <div
      class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
      role='presentation'
      onClick={() => props.onClose()}
    >
      <div
        role='dialog'
        aria-modal='true'
        class='w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6'
        onClick={(e) => e.stopPropagation()}
      >
        <h2 class='text-lg font-semibold truncate pr-6'>
          {isCopy() ? 'Copy' : 'Move'} &quot;{props.fileName}&quot;
        </h2>
        <p class='text-sm text-muted-foreground mt-1'>
          {isCopy() ? 'Choose an editable destination folder' : 'Choose a destination folder'}
        </p>

        <Show when={!isShare() && props.editableFolders.length > 1}>
          <div class='flex gap-1.5 flex-wrap mt-3'>
            <For each={props.editableFolders}>
              {(folder) => {
                const nf = folder.replace(/\\/g, '/')
                return (
                  <button
                    type='button'
                    class='text-xs h-7 px-2 rounded-md border text-sm font-medium'
                    classList={{
                      'bg-primary text-primary-foreground border-primary': selectedRoot() === nf,
                      'border-input bg-background hover:bg-accent': selectedRoot() !== nf,
                    }}
                    onClick={() => handleRootChange(folder)}
                  >
                    {folder}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

        <div class='flex items-center gap-1.5 text-sm text-muted-foreground px-1 mt-3'>
          <Folder class='h-3.5 w-3.5 shrink-0' stroke-width={2} />
          <span class='font-mono text-xs truncate'>{displayPath()}</span>
        </div>

        <div class='border border-border rounded-md max-h-64 overflow-y-auto mt-2'>
          <Show
            when={!dirFiles.loading}
            fallback={
              <div class='flex items-center justify-center py-8'>
                <LoaderCircle class='h-5 w-5 animate-spin text-muted-foreground' stroke-width={2} />
              </div>
            }
          >
            <Show when={dirFiles.error}>
              <div class='px-3 py-6 text-center text-sm text-destructive'>
                {(dirFiles.error as Error).message}
              </div>
            </Show>
            <Show when={!dirFiles.error}>
              <div class='divide-y divide-border'>
                <Show when={canGoUp()}>
                  <button
                    type='button'
                    class='flex items-center gap-2.5 w-full px-3 py-2 hover:bg-muted/50 text-left transition-colors'
                    onClick={() => goUp()}
                  >
                    <ArrowUp class='h-4 w-4 text-muted-foreground shrink-0' stroke-width={2} />
                    <span class='text-sm font-medium'>..</span>
                  </button>
                </Show>
                <Show when={folders().length === 0 && !canGoUp()}>
                  <div class='px-3 py-8 text-center text-sm text-muted-foreground'>
                    No subfolders
                  </div>
                </Show>
                <For each={folders()}>
                  {(folder) => (
                    <button
                      type='button'
                      class='flex items-center gap-2.5 w-full px-3 py-2 hover:bg-muted/50 text-left transition-colors'
                      onClick={() => setBrowsePath(folder.navPath)}
                    >
                      <Folder class='h-4 w-4 text-muted-foreground shrink-0' stroke-width={2} />
                      <span class='text-sm truncate'>{folder.name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        <Show when={props.error}>
          <p class='mt-3 text-sm text-destructive rounded-md bg-destructive/10 border border-destructive/50 px-3 py-2'>
            {props.error?.message}
          </p>
        </Show>

        <div class='flex justify-end gap-2 mt-6'>
          <button
            type='button'
            class='h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent'
            disabled={props.isPending}
            onClick={() => props.onClose()}
          >
            Cancel
          </button>
          <button
            type='button'
            class='h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50'
            disabled={isSameAsSource() || props.isPending}
            onClick={() => props.onConfirm(browsePath())}
          >
            {props.isPending
              ? isCopy()
                ? 'Copying...'
                : 'Moving...'
              : isCopy()
                ? 'Copy here'
                : 'Move here'}
          </button>
        </div>
      </div>
    </div>
  )
}
