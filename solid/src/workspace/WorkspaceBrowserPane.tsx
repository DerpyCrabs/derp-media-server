import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { stripSharePrefix } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import type { Accessor } from 'solid-js'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { Breadcrumbs } from '../file-browser/Breadcrumbs'
import { DeleteFileDialog } from '../file-browser/DeleteFileDialog'
import { FileRowContextMenu } from '../file-browser/FileRowContextMenu'
import { useFileRowContextMenu } from '../file-browser/use-file-row-context-menu'
import { fileIcon } from '../lib/use-file-icon'

export type WorkspaceShareConfig = { token: string; sharePath: string }

type Props = {
  windowId: string
  workspace: Accessor<PersistedWorkspaceState | null>
  sharePanel: Accessor<WorkspaceShareConfig | null>
  editableFolders: string[]
  onNavigateDir: (windowId: string, dir: string) => void
  onOpenViewer: (windowId: string, file: FileItem) => void
  onAddToTaskbar: (file: FileItem) => void
}

function parentDir(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

export function WorkspaceBrowserPane(props: Props) {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)

  const win = createMemo(() => props.workspace()?.windows.find((w) => w.id === props.windowId))

  const currentPath = createMemo(() => win()?.initialState?.dir ?? '')

  const share = createMemo((): WorkspaceShareConfig | null => {
    const w = win()
    if (w?.source.kind === 'share' && w.source.token) {
      return { token: w.source.token, sharePath: w.source.sharePath ?? '' }
    }
    return props.sharePanel() ?? null
  })

  const listDir = createMemo(() => {
    const p = currentPath()
    const sh = share()
    if (sh) return stripSharePrefix(p, sh.sharePath.replace(/\\/g, '/'))
    return p
  })

  const filesQuery = useQuery(() => {
    const sh = share()
    return {
      queryKey: sh ? queryKeys.shareFiles(sh.token, listDir()) : queryKeys.files(listDir()),
      queryFn: () =>
        sh
          ? api<{ files: FileItem[] }>(
              `/api/share/${sh.token}/files?dir=${encodeURIComponent(listDir())}`,
            )
          : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(listDir())}`),
    }
  })

  const files = createMemo(() => filesQuery.data?.files ?? [])

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
  })

  const deleteMutation = useMutation(() => ({
    mutationFn: (itemPath: string) => post('/api/files/delete', { path: itemPath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      }
    },
  }))

  function handleContextDownload(file: FileItem) {
    const link = document.createElement('a')
    const sh = share()
    if (sh) {
      const rel = stripSharePrefix(file.path, sh.sharePath.replace(/\\/g, '/'))
      link.href = `/api/share/${sh.token}/download?path=${encodeURIComponent(rel)}`
    } else {
      link.href = `/api/files/download?path=${encodeURIComponent(file.path)}`
    }
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function handleBreadcrumbNavigate(path: string) {
    props.onNavigateDir(props.windowId, path)
  }

  function handleParentDirectory() {
    props.onNavigateDir(props.windowId, parentDir(currentPath()))
  }

  function handleFileClick(file: FileItem) {
    if (file.isDirectory) {
      props.onNavigateDir(props.windowId, file.path)
      return
    }
    const mt = file.type
    if (mt === MediaType.AUDIO || mt === MediaType.VIDEO) {
      return
    }
    props.onOpenViewer(props.windowId, file)
  }

  return (
    <div
      class='flex min-h-0 flex-1 flex-col overflow-hidden'
      data-testid='workspace-window-visible-content'
    >
      <div class='shrink-0 border-b border-border bg-muted/30 p-1.5'>
        <Breadcrumbs currentPath={currentPath()} onNavigate={handleBreadcrumbNavigate} />
      </div>

      <Show when={filesQuery.isError}>
        <div class='p-4'>
          <p class='text-destructive text-sm'>Failed to load files.</p>
        </div>
      </Show>

      <div class='min-h-0 flex-1 overflow-auto px-2 py-2'>
        <div class='relative w-full overflow-x-auto'>
          <table class='w-full caption-bottom text-sm'>
            <tbody class='[&_tr:last-child]:border-0'>
              <Show when={currentPath()}>
                <tr
                  class='cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50'
                  onClick={handleParentDirectory}
                >
                  <td class='w-12 p-2 align-middle'>
                    <div class='flex items-center justify-center'>
                      <ArrowUp class='h-5 w-5 text-muted-foreground' size={20} stroke-width={2} />
                    </div>
                  </td>
                  <td class='p-2 align-middle font-medium'>..</td>
                  <td class='p-2 align-middle text-right text-muted-foreground' />
                </tr>
              </Show>
              <For each={files()}>
                {(file) => (
                  <tr
                    class='group cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50'
                    onClick={() => handleFileClick(file)}
                    onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                  >
                    <td class='w-12 p-2 align-middle'>
                      <div class='flex items-center justify-center'>{fileIcon(file)}</div>
                    </td>
                    <td class='p-2 align-middle font-medium'>
                      <span class='truncate'>{file.name}</span>
                    </td>
                    <td class='p-2 align-middle text-right text-muted-foreground'>
                      <span class='inline-block w-20 tabular-nums'>
                        {file.isDirectory ? '' : formatFileSize(file.size)}
                      </span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      <FileRowContextMenu
        menu={fileRowMenu.menu}
        editableFolders={() => props.editableFolders}
        onDismiss={fileRowMenu.dismiss}
        onDownload={handleContextDownload}
        onDelete={fileRowMenu.confirmDelete}
        onAddToTaskbar={props.onAddToTaskbar}
      />
      <DeleteFileDialog
        item={deleteTarget}
        isPending={deleteMutation.isPending}
        onDismiss={() => setDeleteTarget(null)}
        onConfirm={() => {
          const it = deleteTarget()
          if (it) void deleteMutation.mutateAsync(it.path).then(() => setDeleteTarget(null))
        }}
      />
    </div>
  )
}
