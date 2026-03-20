import type { GlobalSettings } from '@/lib/use-settings'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { stripSharePrefix } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { cn } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import type { Accessor } from 'solid-js'
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js'
import { Breadcrumbs } from '../file-browser/Breadcrumbs'
import { DeleteFileDialog } from '../file-browser/DeleteFileDialog'
import { FileRowContextMenu } from '../file-browser/FileRowContextMenu'
import { ViewModeToggle } from '../file-browser/ViewModeToggle'
import { useFileRowContextMenu } from '../file-browser/use-file-row-context-menu'
import { fileIcon, gridHeroIcon } from '../lib/use-file-icon'

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
  const [unsupportedFile, setUnsupportedFile] = createSignal<FileItem | null>(null)

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

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !share(),
  }))

  const viewMode = createMemo(() => {
    if (share()) return 'list' as const
    const s = settingsQuery.data
    return s?.viewModes?.[currentPath()] ?? 'list'
  })

  const viewModeMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; viewMode: 'list' | 'grid' }) =>
      post('/api/settings/viewMode', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

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

  createEffect(() => {
    currentPath()
    setUnsupportedFile(null)
  })

  function setViewMode(mode: 'list' | 'grid') {
    if (share()) return
    viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  function unsupportedDownloadHref(file: FileItem) {
    const sh = share()
    if (sh) {
      const rel = stripSharePrefix(file.path, sh.sharePath.replace(/\\/g, '/'))
      return `/api/share/${sh.token}/download?path=${encodeURIComponent(rel)}`
    }
    return `/api/files/download?path=${encodeURIComponent(file.path)}`
  }

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
      setUnsupportedFile(null)
      props.onNavigateDir(props.windowId, file.path)
      return
    }
    const mt = file.type
    if (mt === MediaType.AUDIO || mt === MediaType.VIDEO) {
      return
    }
    if (mt === MediaType.OTHER) {
      setUnsupportedFile(file)
      return
    }
    setUnsupportedFile(null)
    props.onOpenViewer(props.windowId, file)
  }

  createEffect(() => {
    const f = unsupportedFile()
    if (!f) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUnsupportedFile(null)
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <div
      class='relative flex min-h-0 flex-1 flex-col overflow-hidden'
      data-testid='workspace-window-visible-content'
    >
      <div class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 p-1.5'>
        <Breadcrumbs currentPath={currentPath()} onNavigate={handleBreadcrumbNavigate} />
        <Show when={!share()}>
          <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
        </Show>
      </div>

      <Show when={filesQuery.isError}>
        <div class='p-4'>
          <p class='text-destructive text-sm'>Failed to load files.</p>
        </div>
      </Show>

      <div class='relative min-h-0 flex-1 overflow-auto px-2 py-2'>
        <Switch>
          <Match when={viewMode() === 'grid'}>
            <div class='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4'>
              <Show when={currentPath()}>
                <div
                  class='ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50'
                  onClick={handleParentDirectory}
                  onKeyDown={(e) => e.key === 'Enter' && handleParentDirectory()}
                  role='button'
                  tabindex={0}
                >
                  <div class='bg-muted/80 flex aspect-video flex-col items-center justify-center p-4'>
                    <ArrowUp
                      class='mb-2 h-12 w-12 text-muted-foreground'
                      size={48}
                      stroke-width={2}
                    />
                    <p class='text-center text-sm font-medium'>..</p>
                  </div>
                </div>
              </Show>
              <For each={files()}>
                {(file) => (
                  <div
                    class={cn(
                      'ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50',
                    )}
                    onClick={() => handleFileClick(file)}
                    onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFileClick(file)}
                    role='button'
                    tabindex={0}
                  >
                    <div class='group relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                      <div class='text-muted-foreground'>{gridHeroIcon(file)}</div>
                    </div>
                    <div class='flex flex-col gap-1 p-3'>
                      <p class='truncate text-sm font-medium' title={file.name}>
                        {file.name}
                      </p>
                      <div class='flex items-center justify-end text-xs text-muted-foreground'>
                        <span>{file.isDirectory ? '' : formatFileSize(file.size)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={viewMode() === 'list'}>
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
                          <ArrowUp
                            class='h-5 w-5 text-muted-foreground'
                            size={20}
                            stroke-width={2}
                          />
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
          </Match>
        </Switch>

        <Show when={unsupportedFile()}>
          {(get) => {
            const file = get()
            return (
              <div
                class='bg-background/85 absolute inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-sm'
                role='presentation'
                onClick={(e) => e.target === e.currentTarget && setUnsupportedFile(null)}
              >
                <div
                  class='bg-card border-border w-full max-w-sm rounded-lg border p-6 shadow-lg'
                  role='dialog'
                  aria-modal='true'
                  onClick={(e) => e.stopPropagation()}
                >
                  <p class='text-muted-foreground mb-4 text-center text-sm'>
                    This file type cannot be previewed.
                  </p>
                  <a
                    href={unsupportedDownloadHref(file)}
                    download={file.name}
                    class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                  >
                    Download File
                  </a>
                </div>
              </div>
            )
          }}
        </Show>
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
