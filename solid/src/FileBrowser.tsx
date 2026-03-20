import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { GlobalSettings } from '@/lib/use-settings'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'
import { MediaType, type FileItem } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { cn, getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Star from 'lucide-solid/icons/star'
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { Breadcrumbs } from './file-browser/Breadcrumbs'
import { CreateFileDialog } from './file-browser/CreateFileDialog'
import { CreateFolderDialog } from './file-browser/CreateFolderDialog'
import { DeleteFileDialog } from './file-browser/DeleteFileDialog'
import { FileRowContextMenu } from './file-browser/FileRowContextMenu'
import { MoveToDialog } from './file-browser/MoveToDialog'
import { RenameDialog } from './file-browser/RenameDialog'
import { ShareDialog } from './file-browser/ShareDialog'
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

  const sharesQuery = useQuery(() => ({
    queryKey: queryKeys.shares(),
    queryFn: () => api<{ shares: ShareLink[] }>('/api/shares'),
  }))

  const shares = createMemo(() => sharesQuery.data?.shares ?? [])

  const sharedPathSet = createMemo(() => {
    const set = new Set<string>()
    for (const s of shares()) {
      set.add(s.path.replace(/\\/g, '/'))
    }
    return set
  })

  const shareLinkBase = createMemo(() => {
    const d = authQuery.data?.shareLinkDomain
    if (typeof d === 'string' && d.trim()) return d.trim().replace(/\/$/, '')
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  })

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

  const knowledgeBases = createMemo(() => settingsQuery.data?.knowledgeBases ?? [])
  const inKb = createMemo(() => getKnowledgeBaseRoot(currentPath(), knowledgeBases()) !== null)
  const hasEditableFolders = createMemo(() => editableFolders().length > 0)

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
  const [shareTarget, setShareTarget] = createSignal<FileItem | null>(null)
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [showRename, setShowRename] = createSignal(false)
  const [renameItem, setRenameItem] = createSignal<FileItem | null>(null)
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = createSignal(false)
  const [copyTarget, setCopyTarget] = createSignal<FileItem | null>(null)
  const [showCopyDialog, setShowCopyDialog] = createSignal(false)
  const [newItemName, setNewItemName] = createSignal('')

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

  const revokeShareMutation = useMutation(() => ({
    mutationFn: (vars: { token: string }) => post('/api/shares/delete', vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const createFolderMutation = useMutation(() => ({
    mutationFn: (vars: { type: 'folder'; path: string }) => post('/api/files/create', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const createFileMutation = useMutation(() => ({
    mutationFn: (vars: { type: 'file'; path: string; content: string }) =>
      post('/api/files/create', vars),
    onSuccess: (_d, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      viewFile(variables.path, currentPath())
    },
  }))

  const renameMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const moveMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const copyMutation = useMutation(() => ({
    mutationFn: (vars: { sourcePath: string; destinationDir: string }) =>
      post('/api/files/copy', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  function normPath(p: string) {
    return p.replace(/\\/g, '/')
  }

  const shareDialogExistingShares = createMemo(() => {
    const t = shareTarget()
    if (!t) return [] as ShareLink[]
    const np = normPath(t.path)
    return shares().filter((s) => normPath(s.path) === np)
  })

  const shareDialogIsEditable = createMemo(() => {
    const t = shareTarget()
    if (!t) return false
    return isPathEditable(t.path, editableFolders())
  })

  const folderExists = createMemo(() => {
    const n = newItemName().trim()
    if (!n) return false
    return files().some((f) => f.isDirectory && f.name.toLowerCase() === n.toLowerCase())
  })

  const fileExists = createMemo(() => {
    const n = newItemName().trim()
    if (!n) return false
    const defaultExt = inKb() ? '.md' : '.txt'
    const fileName = n.includes('.') ? n : `${n}${defaultExt}`
    return files().some((f) => !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase())
  })

  const renameTargetExists = createMemo(() => {
    const n = newItemName().trim()
    const ed = renameItem()
    if (!n || !ed || renameMutation.isPending) return false
    return files().some((f) => f.path !== ed.path && f.name.toLowerCase() === n.toLowerCase())
  })

  const renameTargetIsDirectory = createMemo(() => {
    const ed = renameItem()
    if (!ed) return false
    return files().find((f) => f.path === ed.path)?.isDirectory ?? ed.isDirectory
  })

  const moveDialogTarget = createMemo(() => (showMoveDialog() ? moveTarget() : null))
  const copyDialogTarget = createMemo(() => (showCopyDialog() ? copyTarget() : null))

  function handleContextShare(file: FileItem) {
    setShareTarget(file)
  }

  async function handleCopyShareLink(file: FileItem) {
    if (!file.shareToken) return
    const url = `${shareLinkBase()}/share/${file.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
  }

  function getPathHasShare(file: FileItem) {
    return sharedPathSet().has(normPath(file.path))
  }

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

  function openCreateFolder() {
    setNewItemName('')
    createFolderMutation.reset()
    setShowCreateFolder(true)
  }

  function openCreateFile() {
    setNewItemName('')
    createFileMutation.reset()
    setShowCreateFile(true)
  }

  function submitCreateFolder() {
    const name = newItemName().trim()
    const folderPath = currentPath() ? `${currentPath()}/${name}` : name
    createFolderMutation.mutate(
      { type: 'folder', path: folderPath },
      {
        onSuccess: () => {
          setShowCreateFolder(false)
          setNewItemName('')
          createFolderMutation.reset()
        },
      },
    )
  }

  function submitCreateFile() {
    let filePath = newItemName().trim()
    if (!filePath) return
    filePath = currentPath() ? `${currentPath()}/${filePath}` : filePath
    const defaultExt = inKb() ? '.md' : '.txt'
    if (!filePath.includes('.')) filePath = `${filePath}${defaultExt}`
    createFileMutation.mutate(
      { type: 'file', path: filePath, content: '' },
      {
        onSuccess: () => {
          setShowCreateFile(false)
          setNewItemName('')
          createFileMutation.reset()
        },
      },
    )
  }

  function handleContextRename(file: FileItem) {
    setRenameItem(file)
    setNewItemName(file.name)
    renameMutation.reset()
    setShowRename(true)
  }

  function submitRename() {
    const ed = renameItem()
    if (!ed) return
    const pathParts = ed.path.split(/[/\\]/).filter(Boolean)
    const parentPath = pathParts.slice(0, -1).join('/')
    const newPath = parentPath ? `${parentPath}/${newItemName().trim()}` : newItemName().trim()
    renameMutation.mutate(
      { oldPath: ed.path, newPath },
      {
        onSuccess: () => {
          setShowRename(false)
          setRenameItem(null)
          setNewItemName('')
          renameMutation.reset()
        },
      },
    )
  }

  function handleContextMove(file: FileItem) {
    setMoveTarget(file)
    moveMutation.reset()
    setShowMoveDialog(true)
  }

  function handleDialogMove(dest: string) {
    const t = moveTarget()
    if (!t) return
    const fileName = t.path.split(/[/\\]/).pop()!
    const normDest = dest.replace(/\\/g, '/').replace(/\/+$/, '')
    const newPath = normDest ? `${normDest}/${fileName}` : fileName
    const oldPath = t.path.replace(/\\/g, '/')
    moveMutation.mutate(
      { oldPath, newPath },
      {
        onSuccess: () => {
          setShowMoveDialog(false)
          setMoveTarget(null)
          moveMutation.reset()
        },
      },
    )
  }

  function handleContextCopyTo(file: FileItem) {
    setCopyTarget(file)
    copyMutation.reset()
    setShowCopyDialog(true)
  }

  function handleCopyToDestination(dest: string) {
    const t = copyTarget()
    if (!t) return
    copyMutation.mutate(
      { sourcePath: t.path, destinationDir: dest },
      {
        onSuccess: () => {
          setShowCopyDialog(false)
          setCopyTarget(null)
          copyMutation.reset()
        },
      },
    )
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
      <MainMediaPlayers editableFolders={editableFolders()} />
      <div class='min-h-screen' data-testid='file-browser'>
        <div class='container mx-auto lg:p-4'>
          <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none lg:rounded-xl py-0 text-sm shadow-xs ring-1'>
            <div class='shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'>
              <div class='flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'>
                <Breadcrumbs currentPath={currentPath()} onNavigate={handleBreadcrumbNavigate} />
                <div class='flex items-center gap-1'>
                  <Show when={isEditable()}>
                    <button
                      type='button'
                      title='Create new folder'
                      aria-label='New folder'
                      class='inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                      onClick={() => openCreateFolder()}
                    >
                      <FolderPlus class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                    </button>
                    <button
                      type='button'
                      title='Create new file'
                      aria-label='New file'
                      class='inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                      onClick={() => openCreateFile()}
                    >
                      <FilePlus class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                    </button>
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
          isCurrentDirEditable={isEditable}
          hasEditableFolders={hasEditableFolders}
          onDismiss={fileRowMenu.dismiss}
          onDownload={handleContextDownload}
          onDelete={fileRowMenu.confirmDelete}
          onShare={handleContextShare}
          onCopyShareLink={handleCopyShareLink}
          getPathHasShare={getPathHasShare}
          onRename={handleContextRename}
          onMove={handleContextMove}
          onCopy={handleContextCopyTo}
        />
        <ShareDialog
          isOpen={!!shareTarget()}
          onClose={() => setShareTarget(null)}
          filePath={shareTarget()?.path ?? ''}
          fileName={shareTarget()?.name ?? ''}
          isDirectory={shareTarget()?.isDirectory ?? false}
          isEditable={shareDialogIsEditable()}
          existingShares={shareDialogExistingShares()}
          shareLinkBase={shareLinkBase()}
        />
        <DeleteFileDialog
          item={deleteTarget}
          isPending={deleteMutation.isPending || revokeShareMutation.isPending}
          onDismiss={() => setDeleteTarget(null)}
          onConfirm={() => {
            const it = deleteTarget()
            if (!it) return
            if (it.shareToken) {
              void revokeShareMutation
                .mutateAsync({ token: it.shareToken })
                .then(() => setDeleteTarget(null))
            } else {
              void deleteMutation.mutateAsync(it.path).then(() => setDeleteTarget(null))
            }
          }}
        />
        <CreateFolderDialog
          isOpen={showCreateFolder()}
          folderName={newItemName()}
          onFolderNameChange={setNewItemName}
          onCreate={() => submitCreateFolder()}
          onCancel={() => {
            setShowCreateFolder(false)
            setNewItemName('')
            createFolderMutation.reset()
          }}
          isPending={createFolderMutation.isPending}
          error={createFolderMutation.error ?? null}
          folderExists={folderExists()}
        />
        <CreateFileDialog
          isOpen={showCreateFile()}
          fileName={newItemName()}
          onFileNameChange={setNewItemName}
          onCreate={() => submitCreateFile()}
          onCancel={() => {
            setShowCreateFile(false)
            setNewItemName('')
            createFileMutation.reset()
          }}
          isPending={createFileMutation.isPending}
          error={createFileMutation.error ?? null}
          fileExists={fileExists()}
          defaultExtension={inKb() ? 'md' : 'txt'}
        />
        <RenameDialog
          isOpen={showRename()}
          itemName={renameItem()?.name ?? ''}
          newName={newItemName()}
          onNewNameChange={setNewItemName}
          onRename={() => submitRename()}
          onCancel={() => {
            setShowRename(false)
            setRenameItem(null)
            setNewItemName('')
            renameMutation.reset()
          }}
          isPending={renameMutation.isPending}
          error={renameMutation.error ?? null}
          nameExists={renameTargetExists()}
          isDirectory={renameTargetIsDirectory()}
        />
        <Show when={moveDialogTarget()} keyed>
          {(file) => (
            <MoveToDialog
              onClose={() => {
                setShowMoveDialog(false)
                setMoveTarget(null)
                moveMutation.reset()
              }}
              fileName={file.name}
              filePath={file.path}
              onConfirm={(dest) => handleDialogMove(dest)}
              isPending={moveMutation.isPending}
              error={moveMutation.error ?? null}
              editableFolders={editableFolders()}
            />
          )}
        </Show>
        <Show when={copyDialogTarget()} keyed>
          {(file) => (
            <MoveToDialog
              mode='copy'
              onClose={() => {
                setShowCopyDialog(false)
                setCopyTarget(null)
                copyMutation.reset()
              }}
              fileName={file.name}
              filePath={file.path}
              onConfirm={(dest) => handleCopyToDestination(dest)}
              isPending={copyMutation.isPending}
              error={copyMutation.error ?? null}
              editableFolders={editableFolders()}
            />
          )}
        </Show>
      </div>
    </>
  )
}
