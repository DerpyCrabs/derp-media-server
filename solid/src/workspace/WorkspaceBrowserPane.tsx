import {
  getFileDragData,
  hasFileDragData,
  isCompatibleSource,
  setFileDragData,
} from '@/lib/file-drag-data'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { GlobalSettings } from '@/lib/use-settings'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { stripSharePrefix } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import type { WorkspaceSource } from '@/lib/use-workspace'
import { formatFileSize } from '@/lib/media-utils'
import { cn, isPathEditable } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
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
  onMount,
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
  /** Share workspace: show create file/folder when upload is allowed (matches React ShareFileBrowser). */
  shareAllowUpload?: boolean
  editableFolders: string[]
  onNavigateDir: (windowId: string, dir: string) => void
  onOpenViewer: (windowId: string, file: FileItem) => void
  onAddToTaskbar: (file: FileItem) => void
  onOpenInNewTab?: (
    windowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => void
  onRequestPlay?: (source: WorkspaceSource, path: string, dir?: string) => void
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
  const [draggedPath, setDraggedPath] = createSignal<string | null>(null)
  const [dragOverPath, setDragOverPath] = createSignal<string | null>(null)
  const [enableDrag, setEnableDrag] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [newFileName, setNewFileName] = createSignal('')
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [newFolderName, setNewFolderName] = createSignal('')

  onMount(() => {
    setEnableDrag(typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches)
  })
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

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const isAdminPaneEditable = createMemo(
    () => !share() && !isVirtualFolder() && isPathEditable(currentPath(), props.editableFolders),
  )
  const showShareCreateToolbar = createMemo(() => !!share() && !!props.shareAllowUpload)
  const showCreateToolbar = createMemo(() => isAdminPaneEditable() || showShareCreateToolbar())

  const parentParts = createMemo(() =>
    currentPath() ? currentPath().split(/[/\\]/).filter(Boolean) : [],
  )
  const dropParentDir = createMemo(() => {
    const p = parentParts()
    if (p.length <= 1) return ''
    return p.slice(0, -1).join('/')
  })
  const canDropOnParent = createMemo(
    () =>
      isAdminPaneEditable() &&
      !!currentPath() &&
      isPathEditable(dropParentDir() || '', props.editableFolders),
  )

  const canDropOn = (targetPath: string, sourcePath?: string | null) => {
    const src = sourcePath ?? draggedPath()
    if (!src || src === targetPath) return false
    if (targetPath.startsWith(src + '/')) return false
    return true
  }

  const dragSourceKind = createMemo((): 'local' | 'share' => (share() ? 'share' : 'local'))
  const dragSourceToken = createMemo(() => share()?.token)

  const moveMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
    },
  }))

  function handleMoveFile(sourcePath: string, destinationDir: string) {
    const fileName = sourcePath.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveMutation.mutate({ oldPath: sourcePath, newPath })
  }

  const allowMoveFile = createMemo(() => (isAdminPaneEditable() ? handleMoveFile : undefined))

  const createFileMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; content: string; shareToken?: string }) =>
      vars.shareToken
        ? post(`/api/share/${vars.shareToken}/create`, {
            type: 'file',
            path: vars.path,
            content: vars.content,
          })
        : post('/api/files/create', { type: 'file', path: vars.path, content: vars.content }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
    },
  }))

  const createFolderMutation = useMutation(() => ({
    mutationFn: (vars: { token: string; path: string }) =>
      post(`/api/share/${vars.token}/create`, { type: 'folder', path: vars.path }),
    onSettled: () => {
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
    },
  }))

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

  function openCreateFileDialog() {
    setNewFileName('')
    setShowCreateFile(true)
  }

  function openCreateFolderDialog() {
    setNewFolderName('')
    setShowCreateFolder(true)
  }

  function submitCreateFile() {
    const name = newFileName().trim()
    if (!name || fileExists()) return
    const sh = share()
    if (sh) {
      const stem = name.includes('.') ? name : `${name}.txt`
      const rel = listDir() ? `${listDir()}/${stem}` : stem
      void createFileMutation
        .mutateAsync({ path: rel, content: '', shareToken: sh.token })
        .then(() => {
          setShowCreateFile(false)
          setNewFileName('')
        })
      return
    }
    const base = currentPath() ? `${currentPath()}/${name}` : name
    const finalPath = base.includes('.') ? base : `${base}.txt`
    void createFileMutation.mutateAsync({ path: finalPath, content: '' }).then(() => {
      setShowCreateFile(false)
      setNewFileName('')
    })
  }

  function submitCreateFolder() {
    const sh = share()
    if (!sh) return
    const name = newFolderName().trim()
    if (!name || folderExists()) return
    const rel = listDir() ? `${listDir()}/${name}` : name
    void createFolderMutation.mutateAsync({ token: sh.token, path: rel }).then(() => {
      setShowCreateFolder(false)
      setNewFolderName('')
    })
  }

  const fileExists = createMemo(() => {
    const n = newFileName().trim().toLowerCase()
    if (!n) return false
    const withExt = n.includes('.') ? n : `${n}.txt`
    return files().some((f) => f.name.toLowerCase() === withExt || f.name.toLowerCase() === n)
  })

  const folderExists = createMemo(() => {
    const n = newFolderName().trim().toLowerCase()
    if (!n) return false
    return files().some((f) => f.isDirectory && f.name.toLowerCase() === n)
  })

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
      const wdef = props.workspace()?.windows.find((x) => x.id === props.windowId)
      const src = wdef?.source
      if (src) props.onRequestPlay?.(src, file.path, currentPath() || undefined)
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

  function parentRowDragOver(e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!canDropOnParent() || !allowMoveFile()) return
    if (!dtr || (!draggedPath() && !hasFileDragData(dtr))) return
    e.preventDefault()
    dtr.dropEffect = 'move'
    setDragOverPath('__parent__')
  }

  function parentRowDragLeave(e: globalThis.DragEvent) {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node) && dragOverPath() === '__parent__') {
      setDragOverPath(null)
    }
  }

  function parentRowDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    setDragOverPath(null)
    const mv = allowMoveFile()
    if (!mv) return
    const dest = parentDir(currentPath())
    const dp = draggedPath()
    if (dp) {
      mv(dp, dest)
      return
    }
    const dtr = e.dataTransfer
    if (!dtr) return
    const data = getFileDragData(dtr)
    if (
      data &&
      isCompatibleSource({ sourceKind: dragSourceKind(), sourceToken: dragSourceToken() }, data) &&
      canDropOn(dest, data.path)
    ) {
      mv(data.path, dest)
    }
  }

  function onFileDragStart(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (
      !dtr ||
      !enableDrag() ||
      !isPathEditable(file.path, props.editableFolders) ||
      !allowMoveFile()
    )
      return
    const kind = dragSourceKind()
    const tok = dragSourceToken()
    setFileDragData(dtr, {
      path: file.path,
      isDirectory: file.isDirectory,
      sourceKind: kind,
      ...(kind === 'share' && tok ? { sourceToken: tok } : {}),
    })
    dtr.effectAllowed = 'copyMove'
    setDraggedPath(file.path)
  }

  function onFileDragEnd() {
    setDraggedPath(null)
    setDragOverPath(null)
  }

  function onFolderDragOver(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!file.isDirectory || !allowMoveFile() || !dtr) return
    const hasCross = !draggedPath() && hasFileDragData(dtr)
    if (!draggedPath() && !hasCross) return
    const dp = draggedPath()
    if (dp && !canDropOn(file.path)) return
    if (!isPathEditable(file.path, props.editableFolders)) return
    e.preventDefault()
    dtr.dropEffect = 'move'
    setDragOverPath(file.path)
  }

  function onFolderDragLeave(file: FileItem, e: globalThis.DragEvent) {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node) && dragOverPath() === file.path) {
      setDragOverPath(null)
    }
  }

  function onFolderDrop(file: FileItem, e: globalThis.DragEvent) {
    e.preventDefault()
    setDragOverPath(null)
    const mv = allowMoveFile()
    if (!mv || !file.isDirectory) return
    const dp = draggedPath()
    if (dp && canDropOn(file.path)) {
      mv(dp, file.path)
      return
    }
    if (!dp) {
      const dtr = e.dataTransfer
      if (!dtr) return
      const data = getFileDragData(dtr)
      if (
        data &&
        isCompatibleSource(
          { sourceKind: dragSourceKind(), sourceToken: dragSourceToken() },
          data,
        ) &&
        canDropOn(file.path, data.path)
      ) {
        mv(data.path, file.path)
      }
    }
  }

  return (
    <div class='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div
        data-no-window-drag
        class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 p-1.5'
      >
        <Breadcrumbs currentPath={currentPath()} onNavigate={handleBreadcrumbNavigate} />
        <div class='flex items-center gap-1'>
          <Show when={showShareCreateToolbar()}>
            <button
              type='button'
              title='Create new folder'
              class='text-muted-foreground hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded border border-border'
              onClick={openCreateFolderDialog}
            >
              <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
            </button>
          </Show>
          <Show when={showCreateToolbar()}>
            <button
              type='button'
              title='Create new file'
              class='text-muted-foreground hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded border border-border'
              onClick={openCreateFileDialog}
            >
              <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
            </button>
          </Show>
          <Show when={!share()}>
            <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
          </Show>
        </div>
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
                  data-no-window-drag
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
                    data-no-window-drag
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
                      data-no-window-drag
                      class={cn(
                        'cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50',
                        dragOverPath() === '__parent__' ? 'bg-primary/20' : '',
                      )}
                      onClick={handleParentDirectory}
                      onDragOver={allowMoveFile() ? parentRowDragOver : undefined}
                      onDragLeave={allowMoveFile() ? parentRowDragLeave : undefined}
                      onDrop={allowMoveFile() ? parentRowDrop : undefined}
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
                      const canDragRow =
                        enableDrag() &&
                        isPathEditable(file.path, props.editableFolders) &&
                        !!allowMoveFile()
                      return (
                        <tr
                          data-no-window-drag
                          class={cn(
                            'group cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50',
                            file.isDirectory && dragOverPath() === file.path ? 'bg-primary/20' : '',
                            draggedPath() === file.path ? 'opacity-50' : '',
                          )}
                          draggable={canDragRow}
                          onClick={() => handleFileClick(file)}
                          onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                          onDragStart={(e) => onFileDragStart(file, e)}
                          onDragEnd={onFileDragEnd}
                          onDragOver={
                            file.isDirectory && allowMoveFile()
                              ? (e) => onFolderDragOver(file, e)
                              : undefined
                          }
                          onDragLeave={
                            file.isDirectory && allowMoveFile()
                              ? (e) => onFolderDragLeave(file, e)
                              : undefined
                          }
                          onDrop={
                            file.isDirectory && allowMoveFile()
                              ? (e) => onFolderDrop(file, e)
                              : undefined
                          }
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
                      )
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </Match>
        </Switch>

        <Show when={unsupportedFile()} keyed>
          {(file) => (
            <div
              data-no-window-drag
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
          )}
        </Show>
      </div>

      <FileRowContextMenu
        menu={fileRowMenu.menu}
        editableFolders={() => props.editableFolders}
        isCurrentDirEditable={isAdminPaneEditable}
        hasEditableFolders={() => props.editableFolders.length > 0}
        onDismiss={fileRowMenu.dismiss}
        onDownload={handleContextDownload}
        onDelete={fileRowMenu.confirmDelete}
        onAddToTaskbar={props.onAddToTaskbar}
        onOpenInNewTab={
          props.onOpenInNewTab
            ? (f) =>
                props.onOpenInNewTab!(
                  props.windowId,
                  { path: f.path, isDirectory: f.isDirectory, isVirtual: f.isVirtual },
                  currentPath(),
                )
            : undefined
        }
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

      <Show when={showCreateFolder()}>
        <div
          data-no-window-drag
          class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
          role='presentation'
          onClick={() => setShowCreateFolder(false)}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='workspace-create-folder-title'
            class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id='workspace-create-folder-title' class='text-lg font-semibold'>
              Create folder
            </h2>
            <form
              class='mt-4 space-y-4'
              onSubmit={(e) => {
                e.preventDefault()
                submitCreateFolder()
              }}
            >
              <input
                type='text'
                class='mt-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                placeholder='Folder name'
                value={newFolderName()}
                onInput={(e) => setNewFolderName((e.currentTarget as HTMLInputElement).value)}
              />
              <Show when={folderExists()}>
                <p class='text-sm text-amber-600'>A folder with this name already exists.</p>
              </Show>
              <Show when={createFolderMutation.isError}>
                <p class='text-destructive text-sm'>
                  {(createFolderMutation.error as Error)?.message ?? 'Create failed'}
                </p>
              </Show>
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
                  class='bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm disabled:opacity-50'
                  disabled={
                    createFolderMutation.isPending || !newFolderName().trim() || folderExists()
                  }
                >
                  {createFolderMutation.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      <Show when={showCreateFile()}>
        <div
          data-no-window-drag
          class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
          role='presentation'
          onClick={() => setShowCreateFile(false)}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='workspace-create-file-title'
            class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id='workspace-create-file-title' class='text-lg font-semibold'>
              Create New File
            </h2>
            <p class='text-muted-foreground mt-1 text-sm'>
              Enter a name. A .txt extension will be added if none is provided.
            </p>
            <input
              type='text'
              class='mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              placeholder='File name (e.g., notes.txt)'
              value={newFileName()}
              onInput={(e) => setNewFileName((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFileName().trim() && !fileExists()) submitCreateFile()
              }}
            />
            <Show when={fileExists()}>
              <p class='mt-2 text-sm text-amber-600'>A file with this name already exists.</p>
            </Show>
            <Show when={createFileMutation.isError}>
              <p class='text-destructive mt-2 text-sm'>
                {(createFileMutation.error as Error)?.message ?? 'Create failed'}
              </p>
            </Show>
            <div class='mt-6 flex justify-end gap-2'>
              <button
                type='button'
                class='h-9 rounded-md border border-input px-4 text-sm'
                onClick={() => setShowCreateFile(false)}
              >
                Cancel
              </button>
              <button
                type='button'
                class='bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm disabled:opacity-50'
                disabled={createFileMutation.isPending || !newFileName().trim() || fileExists()}
                onClick={() => submitCreateFile()}
              >
                {createFileMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
