import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { GlobalSettings } from '@/lib/use-settings'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { MediaType, type FileItem } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { cn, isPathEditable } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import Star from 'lucide-solid/icons/star'
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { Breadcrumbs } from './file-browser/Breadcrumbs'
import { DeleteFileDialog } from './file-browser/DeleteFileDialog'
import { FileRowContextMenu } from './file-browser/FileRowContextMenu'
import { navigateToFolder } from './file-browser/navigate-folder'
import { useFileRowContextMenu } from './file-browser/use-file-row-context-menu'
import { UploadMenu } from './file-browser/UploadMenu'
import type { AuthConfig, UploadToastState } from './file-browser/types'
import { UploadToastStack } from './file-browser/UploadToastStack'
import { ViewModeToggle } from './file-browser/ViewModeToggle'
import { fileIcon, gridHeroIcon } from './lib/use-file-icon'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { playFile, viewFile } from './lib/url-state-actions'

export function FileBrowser() {
  const history = useBrowserHistory()
  const queryClient = useQueryClient()

  const currentPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
  }))

  const editableFolders = createMemo(() => authQuery.data?.editableFolders ?? [])
  const isEditable = createMemo(
    () => !isVirtualFolder() && isPathEditable(currentPath(), editableFolders()),
  )

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(currentPath()),
    queryFn: () =>
      api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentPath())}`),
  }))

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
  }))

  const files = createMemo(() => filesQuery.data?.files ?? [])

  const viewMode = createMemo(() => {
    const s = settingsQuery.data
    return s?.viewModes?.[currentPath()] ?? 'list'
  })

  const favorites = createMemo(() => settingsQuery.data?.favorites ?? [])
  const favoriteSet = createMemo(() => new Set(favorites()))

  const viewModeMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; viewMode: 'list' | 'grid' }) =>
      post('/api/settings/viewMode', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const favoriteMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES) })
    },
  }))

  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
  })

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')

  const deleteMutation = useMutation(() => ({
    mutationFn: (itemPath: string) => post('/api/files/delete', { path: itemPath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  async function uploadFilesToServer(files: File[], targetDir: string) {
    if (files.length === 0) return
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const formData = new FormData()
      formData.append('targetDir', targetDir)
      for (const file of files) {
        formData.append('files', file, file.name)
      }
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        const message = data?.error || `Upload failed (${res.status})`
        setUploadToast({ kind: 'error', message })
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      setUploadToast({ kind: 'success' })
      window.setTimeout(() => {
        setUploadToast({ kind: 'hidden' })
      }, 2000)
    } catch (err) {
      setUploadToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  function handleParentDirectory() {
    if (isVirtualFolder()) {
      navigateToFolder(null)
      return
    }
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    if (parts.length > 0) {
      const parentPath = parts.slice(0, -1).join('/')
      navigateToFolder(parentPath || null)
    }
  }

  function handleBreadcrumbNavigate(path: string) {
    navigateToFolder(path || null)
  }

  function handleContextDownload(file: FileItem) {
    const link = document.createElement('a')
    link.href = `/api/files/download?path=${encodeURIComponent(file.path)}`
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function handleFileClick(file: FileItem) {
    if (file.isDirectory) {
      navigateToFolder(file.path)
      return
    }

    void post('/api/stats/views', { filePath: file.path }).catch(() => {})
    const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO
    if (isMediaFile) {
      useMediaPlayer
        .getState()
        .playFile(file.path, file.type === MediaType.AUDIO ? 'audio' : 'video')
      playFile(file.path, currentPath())
    } else {
      viewFile(file.path, currentPath())
    }
  }

  function setViewMode(mode: 'list' | 'grid') {
    viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  return (
    <>
      <MainMediaPlayers />
      <div class='min-h-screen' data-testid='file-browser'>
        <div class='container mx-auto lg:p-4'>
          <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none lg:rounded-xl py-0 text-sm shadow-xs ring-1'>
            <div class='shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'>
              <div class='flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'>
                <Breadcrumbs currentPath={currentPath()} onNavigate={handleBreadcrumbNavigate} />
                <div class='flex items-center gap-1'>
                  <Show when={isEditable()}>
                    <UploadMenu
                      disabled={isUploading()}
                      onUpload={(files) => void uploadFilesToServer(files, currentPath())}
                    />
                  </Show>
                  <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
                </div>
              </div>
            </div>

            <div class='flex flex-col min-h-0 flex-1 overflow-hidden'>
              <Show when={filesQuery.isError}>
                <div class='p-4'>
                  <p class='text-destructive text-sm'>Failed to load files.</p>
                </div>
              </Show>

              <Switch>
                <Match when={viewMode() === 'grid'}>
                  <div class='py-4 px-4'>
                    <div class='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
                      <Show when={currentPath()}>
                        <div
                          class='ring-foreground/10 bg-card text-card-foreground cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 rounded-xl text-left shadow-xs ring-1 overflow-hidden flex flex-col'
                          onClick={handleParentDirectory}
                          onKeyDown={(e) => e.key === 'Enter' && handleParentDirectory()}
                          role='button'
                          tabindex={0}
                        >
                          <div class='flex aspect-video flex-col items-center justify-center p-4 bg-muted/80'>
                            <ArrowUp
                              class='mb-2 h-12 w-12 text-muted-foreground'
                              size={48}
                              stroke-width={2}
                            />
                            <p class='text-center text-sm font-medium'>..</p>
                            <p class='text-center text-xs text-muted-foreground'>Parent Folder</p>
                          </div>
                        </div>
                      </Show>
                      <For each={files()}>
                        {(file) => {
                          const isFav = () => favoriteSet().has(file.path)
                          return (
                            <div
                              class={cn(
                                'ring-foreground/10 bg-card text-card-foreground cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 rounded-xl text-left shadow-xs ring-1 overflow-hidden flex flex-col',
                              )}
                              onClick={() => handleFileClick(file)}
                              onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                              onKeyDown={(e) => e.key === 'Enter' && handleFileClick(file)}
                              role='button'
                              tabindex={0}
                            >
                              <div class='group relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                                <Show when={!file.isDirectory}>
                                  <button
                                    type='button'
                                    class={cn(
                                      'absolute top-1.5 left-1.5 z-10 rounded-full p-1 transition-all',
                                      isFav()
                                        ? 'bg-background/90 shadow-sm hover:bg-background'
                                        : 'bg-background/70 opacity-60 hover:bg-background/90 group-hover:opacity-100',
                                    )}
                                    title={isFav() ? 'Remove from favorites' : 'Add to favorites'}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      favoriteMutation.mutate({ filePath: file.path })
                                    }}
                                  >
                                    <Star
                                      class={cn(
                                        'h-3.5 w-3.5',
                                        isFav()
                                          ? 'fill-yellow-400 text-yellow-400'
                                          : 'text-muted-foreground',
                                      )}
                                      fill={isFav() ? 'currentColor' : 'none'}
                                      stroke-width={2}
                                    />
                                  </button>
                                </Show>
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
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </Match>
                <Match when={viewMode() === 'list'}>
                  <div class='sm:px-4 py-2'>
                    <div class='relative w-full overflow-x-auto'>
                      <table class='w-full caption-bottom text-sm'>
                        <tbody class='[&_tr:last-child]:border-0'>
                          <Show when={currentPath()}>
                            <tr
                              class='border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none'
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
                            {(file) => {
                              const isFav = () => favoriteSet().has(file.path)
                              return (
                                <tr
                                  class='border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none group'
                                  onClick={() => handleFileClick(file)}
                                  onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                                >
                                  <td class='w-12 p-2 align-middle'>
                                    <div class='flex items-center justify-center'>
                                      {fileIcon(file)}
                                    </div>
                                  </td>
                                  <td class='p-2 align-middle font-medium'>
                                    <div class='flex items-center gap-2 min-w-0'>
                                      <Show when={!file.isDirectory}>
                                        <button
                                          type='button'
                                          class='shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100 transition-opacity inline-flex'
                                          title={
                                            isFav() ? 'Remove from favorites' : 'Add to favorites'
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            favoriteMutation.mutate({ filePath: file.path })
                                          }}
                                        >
                                          <Star
                                            class={cn(
                                              'h-4 w-4',
                                              isFav()
                                                ? 'fill-yellow-400 text-yellow-400 opacity-100'
                                                : 'text-muted-foreground',
                                            )}
                                            fill={isFav() ? 'currentColor' : 'none'}
                                            size={16}
                                            stroke-width={2}
                                          />
                                        </button>
                                      </Show>
                                      <span class='truncate'>{file.name}</span>
                                    </div>
                                  </td>
                                  <td class='p-2 align-middle text-right text-muted-foreground'>
                                    <span class='inline-block w-20 tabular-nums'>
                                      {file.isDirectory ? '' : formatFileSize(file.size)}
                                    </span>
                                  </td>
                                </tr>
                              )
                            }}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Match>
              </Switch>
            </div>
          </div>
        </div>

        <UploadToastStack
          state={uploadToast}
          onDismissError={() => setUploadToast({ kind: 'hidden' })}
        />
        <FileRowContextMenu
          menu={fileRowMenu.menu}
          editableFolders={editableFolders}
          onDismiss={fileRowMenu.dismiss}
          onDownload={handleContextDownload}
          onDelete={fileRowMenu.confirmDelete}
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
    </>
  )
}
