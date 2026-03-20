import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { cn } from '@/lib/utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import FilePlus from 'lucide-solid/icons/file-plus'
import Folder from 'lucide-solid/icons/folder'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { DeleteFileDialog } from './file-browser/DeleteFileDialog'
import { useShareFileWatcher } from './lib/use-share-file-watcher'
import { navigateToFolder, playFile, viewFile } from './lib/url-state-actions'
import { fileIcon } from './lib/use-file-icon'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import type { TextViewerShareContext } from './media/TextViewerDialog'

type ShareRestrictions = {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

export type ShareInfoPayload = {
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  restrictions?: ShareRestrictions
}

function stripSharePrefix(filePath: string, sharePath: string) {
  const sharePathNorm = sharePath.replace(/\\/g, '/')
  const fwd = filePath.replace(/\\/g, '/')
  return fwd.startsWith(sharePathNorm + '/') ? fwd.slice(sharePathNorm.length + 1) : fwd
}

type MenuState = { x: number; y: number; file: FileItem }

type Props = {
  token: string
  shareInfo: ShareInfoPayload
}

export function ShareFolderBrowser(props: Props) {
  const history = useBrowserHistory()
  const queryClient = useQueryClient()
  useShareFileWatcher(props.token)

  const [rowMenu, setRowMenu] = createSignal<MenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [newItemName, setNewItemName] = createSignal('')

  const currentSubDir = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })

  const shareContext = createMemo(
    (): TextViewerShareContext => ({
      token: props.token,
      sharePath: props.shareInfo.path,
      isDirectory: props.shareInfo.isDirectory,
    }),
  )

  const shareCanEdit = createMemo(
    () => props.shareInfo.editable && props.shareInfo.restrictions?.allowEdit !== false,
  )

  const canUpload = createMemo(
    () => props.shareInfo.editable && props.shareInfo.restrictions?.allowUpload !== false,
  )

  const canDelete = createMemo(
    () => props.shareInfo.editable && props.shareInfo.restrictions?.allowDelete !== false,
  )

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.shareFiles(props.token, currentSubDir()),
    queryFn: () =>
      api<{ files: FileItem[] }>(
        `/api/share/${props.token}/files?dir=${encodeURIComponent(currentSubDir())}`,
      ),
  }))

  const files = createMemo(() => filesQuery.data?.files ?? [])

  const viewMutation = useMutation(() => ({
    mutationFn: (relativePath: string) =>
      post(`/api/share/${props.token}/view`, { filePath: relativePath }),
  }))

  const createFolderMutation = useMutation(() => ({
    mutationFn: (vars: { type: string; path: string }) =>
      post(`/api/share/${props.token}/create`, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
      setShowCreateFolder(false)
      setNewItemName('')
    },
  }))

  const createFileMutation = useMutation(() => ({
    mutationFn: (vars: { type: string; path: string; content?: string }) =>
      post(`/api/share/${props.token}/create`, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
      setShowCreateFile(false)
      setNewItemName('')
    },
  }))

  const deleteItemMutation = useMutation(() => ({
    mutationFn: (relativePath: string) =>
      post(`/api/share/${props.token}/delete`, { path: relativePath }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
      setDeleteTarget(null)
    },
  }))

  const breadcrumbs = createMemo(() => {
    const parts = currentSubDir() ? currentSubDir().split('/').filter(Boolean) : []
    return [
      { name: props.shareInfo.name, path: '' },
      ...parts.map((part, i) => ({
        name: part,
        path: parts.slice(0, i + 1).join('/'),
      })),
    ]
  })

  onMount(() => {
    useMediaPlayer.getState().setShareContext(props.token, props.shareInfo.path)
  })

  onCleanup(() => {
    useMediaPlayer.getState().clearShareContext()
  })

  function dismissMenu() {
    setRowMenu(null)
  }

  function openRowMenu(e: MouseEvent, file: FileItem) {
    e.preventDefault()
    e.stopPropagation()
    setRowMenu({ x: e.clientX, y: e.clientY, file })
  }

  function handleParentDirectory() {
    const sub = currentSubDir()
    if (!sub) return
    const parts = sub.split('/').filter(Boolean)
    if (parts.length <= 1) {
      navigateToFolder(null)
    } else {
      navigateToFolder(parts.slice(0, -1).join('/'))
    }
  }

  function handleDownload(file: FileItem) {
    const rel = stripSharePrefix(file.path, props.shareInfo.path)
    const a = document.createElement('a')
    a.href = `/api/share/${props.token}/download?path=${encodeURIComponent(rel)}`
    a.download = file.name
    a.click()
  }

  function handleFileClick(file: FileItem) {
    const strip = (p: string) => stripSharePrefix(p, props.shareInfo.path)
    if (file.isDirectory) {
      navigateToFolder(strip(file.path))
      return
    }

    viewMutation.mutate(strip(file.path))
    const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO
    if (isMediaFile) {
      useMediaPlayer
        .getState()
        .playFile(file.path, file.type === MediaType.AUDIO ? 'audio' : 'video')
      playFile(file.path)
    } else {
      viewFile(file.path)
    }
  }

  function submitCreateFolder(e: Event) {
    e.preventDefault()
    const name = newItemName().trim()
    if (!name) return
    const sub = currentSubDir() ? `${currentSubDir()}/${name}` : name
    createFolderMutation.mutate({ type: 'folder', path: sub })
  }

  function submitCreateFile(e: Event) {
    e.preventDefault()
    let name = newItemName().trim()
    if (!name) return
    if (!name.includes('.')) name = `${name}.txt`
    const sub = currentSubDir() ? `${currentSubDir()}/${name}` : name
    createFileMutation.mutate({ type: 'file', path: sub, content: '' })
  }

  return (
    <>
      <MainMediaPlayers
        shareContext={shareContext()}
        shareCanEdit={shareCanEdit()}
        editableFolders={[]}
      />
      <div class='min-h-screen' data-testid='share-file-browser'>
        <Show when={rowMenu()}>
          {(getCtx) => {
            const ctx = getCtx()
            return (
              <>
                <div
                  class='fixed inset-0 z-[400000]'
                  role='presentation'
                  onClick={() => dismissMenu()}
                />
                <div
                  data-slot='share-row-context-menu'
                  class='fixed z-[500000] min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
                  style={{ left: `${ctx.x}px`, top: `${ctx.y}px` }}
                  role='menu'
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type='button'
                    data-slot='context-menu-item'
                    class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                    role='menuitem'
                    onClick={() => {
                      handleDownload(ctx.file)
                      dismissMenu()
                    }}
                  >
                    {ctx.file.isDirectory ? 'Download as ZIP' : 'Download'}
                  </button>
                  <Show when={canDelete()}>
                    <button
                      type='button'
                      data-slot='context-menu-item'
                      class='text-destructive flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                      role='menuitem'
                      onClick={() => {
                        setDeleteTarget(ctx.file)
                        dismissMenu()
                      }}
                    >
                      Delete
                    </button>
                  </Show>
                </div>
              </>
            )
          }}
        </Show>

        <DeleteFileDialog
          item={deleteTarget}
          isPending={deleteItemMutation.isPending}
          onDismiss={() => setDeleteTarget(null)}
          onConfirm={() => {
            const it = deleteTarget()
            if (!it) return
            const rel = stripSharePrefix(it.path, props.shareInfo.path)
            void deleteItemMutation.mutateAsync(rel)
          }}
        />

        <Show when={showCreateFolder()}>
          <div
            class='fixed inset-0 z-[600000] flex items-center justify-center bg-black/50 p-4'
            role='presentation'
            onClick={() => setShowCreateFolder(false)}
          >
            <div
              role='dialog'
              aria-modal='true'
              class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 class='text-lg font-semibold'>Create folder</h2>
              <form class='mt-4 space-y-4' onSubmit={submitCreateFolder}>
                <input
                  type='text'
                  placeholder='Folder name'
                  class='border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm'
                  value={newItemName()}
                  onInput={(e) => setNewItemName(e.currentTarget.value)}
                />
                <div class='flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md border border-input px-4 text-sm'
                    onClick={() => setShowCreateFolder(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    class='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
                    disabled={createFolderMutation.isPending}
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Show>

        <Show when={showCreateFile()}>
          <div
            class='fixed inset-0 z-[600000] flex items-center justify-center bg-black/50 p-4'
            role='presentation'
            onClick={() => setShowCreateFile(false)}
          >
            <div
              role='dialog'
              aria-modal='true'
              class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 class='text-lg font-semibold'>Create file</h2>
              <form class='mt-4 space-y-4' onSubmit={submitCreateFile}>
                <input
                  type='text'
                  class='border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm'
                  value={newItemName()}
                  placeholder='filename.txt'
                  onInput={(e) => setNewItemName(e.currentTarget.value)}
                />
                <div class='flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md border border-input px-4 text-sm'
                    onClick={() => setShowCreateFile(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    class='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
                    disabled={createFileMutation.isPending}
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Show>

        <div class='container mx-auto lg:p-4'>
          <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none py-0 text-sm shadow-xs ring-1 lg:rounded-xl'>
            <div class='shrink-0 border-b border-border bg-muted/30 p-2'>
              <div class='flex flex-wrap items-center justify-between gap-2'>
                <nav
                  class='flex min-w-0 flex-1 flex-wrap items-center gap-1'
                  aria-label='Breadcrumb'
                >
                  <For each={breadcrumbs()}>
                    {(crumb, index) => (
                      <div class='flex items-center gap-2'>
                        <Show when={index() > 0}>
                          <ChevronRight
                            class='h-4 w-4 shrink-0 text-muted-foreground'
                            size={16}
                            stroke-width={2}
                          />
                        </Show>
                        <button
                          type='button'
                          class={cn(
                            'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            index() === breadcrumbs().length - 1
                              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                              : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                          )}
                          onClick={() => navigateToFolder(crumb.path || null)}
                        >
                          <Show when={index() === 0}>
                            <Folder class='h-4 w-4 shrink-0' size={16} stroke-width={2} />
                          </Show>
                          {crumb.name}
                        </button>
                      </div>
                    )}
                  </For>
                </nav>
                <Show when={canUpload()}>
                  <div class='flex items-center gap-1'>
                    <button
                      type='button'
                      title='Create new file'
                      class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
                      onClick={() => {
                        setNewItemName('')
                        setShowCreateFile(true)
                      }}
                    >
                      <FilePlus class='h-4 w-4' stroke-width={2} />
                    </button>
                    <button
                      type='button'
                      title='Create new folder'
                      class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
                      onClick={() => {
                        setNewItemName('')
                        setShowCreateFolder(true)
                      }}
                    >
                      <FolderPlus class='h-4 w-4' stroke-width={2} />
                    </button>
                  </div>
                </Show>
              </div>
            </div>
            <div class='flex min-h-0 flex-1 flex-col overflow-hidden'>
              <Show when={filesQuery.isError}>
                <div class='p-4'>
                  <p class='text-destructive text-sm'>Failed to load files.</p>
                </div>
              </Show>
              <div class='py-2 sm:px-4'>
                <div class='relative w-full overflow-x-auto'>
                  <table class='w-full caption-bottom text-sm'>
                    <tbody class='[&_tr:last-child]:border-0'>
                      <Show when={currentSubDir()}>
                        <tr
                          class='hover:bg-muted/50 cursor-pointer select-none border-b border-border transition-colors'
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
                            class='hover:bg-muted/50 group cursor-pointer select-none border-b border-border transition-colors'
                            onClick={() => handleFileClick(file)}
                            onContextMenu={(e) => openRowMenu(e, file)}
                          >
                            <td class='w-12 p-2 align-middle'>
                              <div class='flex items-center justify-center'>{fileIcon(file)}</div>
                            </td>
                            <td class='p-2 align-middle font-medium'>
                              <span class='truncate'>{file.name}</span>
                            </td>
                            <td class='p-2 align-middle text-right text-muted-foreground tabular-nums'>
                              <span class='inline-block w-20'>
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
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
