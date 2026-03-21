import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { useBrowserViewModeStore } from '@/lib/browser-view-mode-store'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { cn } from '@/lib/utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import AppWindow from 'lucide-solid/icons/app-window'
import FilePlus from 'lucide-solid/icons/file-plus'
import Folder from 'lucide-solid/icons/folder'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js'
import { useBrowserHistory } from './browser-history'
import {
  BreadcrumbContextMenu,
  type BreadcrumbMenuTarget,
} from './file-browser/BreadcrumbContextMenu'
import { DeleteFileDialog } from './file-browser/DeleteFileDialog'
import { MoveToDialog } from './file-browser/MoveToDialog'
import { RenameDialog } from './file-browser/RenameDialog'
import { UploadMenu } from './file-browser/UploadMenu'
import type { UploadToastState } from './file-browser/types'
import { UploadToastStack } from './file-browser/UploadToastStack'
import { ViewModeToggle } from './file-browser/ViewModeToggle'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { useShareFileWatcher } from './lib/use-share-file-watcher'
import { createLongPressContextMenuHandlers } from './lib/long-press-context-menu'
import { navigateToFolder, playFile, viewFile } from './lib/url-state-actions'
import { EMPTY_FILE_ICON_CONTEXT, fileIcon, gridHeroIcon } from './lib/use-file-icon'
import { ThemeSwitcher } from './ThemeSwitcher'
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
  isKnowledgeBase?: boolean
  adminViewMode: 'list' | 'grid'
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
  useDynamicFavicon(() => ({}), {
    rootName: props.shareInfo.name,
    getSearch: () => history().search,
  })

  const [rowMenu, setRowMenu] = createSignal<MenuState | null>(null)
  const [breadcrumbMenu, setBreadcrumbMenu] = createSignal<BreadcrumbMenuTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [newItemName, setNewItemName] = createSignal('')
  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  const [showRename, setShowRename] = createSignal(false)
  const [renamingItem, setRenamingItem] = createSignal<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = createSignal('')
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [shareViewModeTick, setShareViewModeTick] = createSignal(0)
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  let externalUploadDragDepth = 0
  let inlineFileInputEl: HTMLInputElement | undefined
  let inlineFolderInputEl: HTMLInputElement | undefined

  createEffect(() => {
    const m = inlineMode()
    if (m === 'file') {
      queueMicrotask(() => inlineFileInputEl?.focus())
    } else if (m === 'folder') {
      queueMicrotask(() => inlineFolderInputEl?.focus())
    }
  })

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

  const inKb = createMemo(() => !!props.shareInfo.isKnowledgeBase)
  const showInlineCreate = createMemo(() => canUpload() && inKb())

  createEffect(
    on(
      currentSubDir,
      () => {
        setInlineMode(null)
        setInlineName('')
      },
      { defer: true },
    ),
  )

  const inlineFileExists = createMemo(() => {
    if (inlineMode() !== 'file') return false
    const stem = inlineName().trim()
    if (!stem) return false
    const addExt = inKb() ? '.md' : '.txt'
    const finalName = stem.includes('.') ? stem : `${stem}${addExt}`
    return files().some((f) => !f.isDirectory && f.name.toLowerCase() === finalName.toLowerCase())
  })

  const inlineFolderExists = createMemo(() => {
    if (inlineMode() !== 'folder') return false
    const n = inlineName().trim().toLowerCase()
    if (!n) return false
    return files().some((f) => f.isDirectory && f.name.toLowerCase() === n)
  })

  function submitInlineFile() {
    const stem = inlineName().trim()
    if (!stem || inlineFileExists() || !showInlineCreate()) return
    const defaultExt = inKb() ? '.md' : '.txt'
    const fileStem = stem.includes('.') ? stem : `${stem}${defaultExt}`
    const subPath = currentSubDir() ? `${currentSubDir()}/${fileStem}` : fileStem
    const sharePathNorm = props.shareInfo.path.replace(/\\/g, '/')
    const fullPath = sharePathNorm ? `${sharePathNorm}/${subPath}` : subPath
    createFileMutation.mutate(
      { type: 'file', path: subPath, content: '' },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFileMutation.reset()
          if (inKb()) viewFile(fullPath)
        },
      },
    )
  }

  function submitInlineFolder() {
    const name = inlineName().trim()
    if (!name || inlineFolderExists() || !showInlineCreate()) return
    const subPath = currentSubDir() ? `${currentSubDir()}/${name}` : name
    createFolderMutation.mutate(
      { type: 'folder', path: subPath },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFolderMutation.reset()
        },
      },
    )
  }

  function resetInlineCreate() {
    setInlineMode(null)
    setInlineName('')
    createFileMutation.reset()
    createFolderMutation.reset()
  }

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

  const renameItemMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) =>
      post(`/api/share/${props.token}/rename`, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
    },
  }))

  const moveItemMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) =>
      post(`/api/share/${props.token}/rename`, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
    },
  }))

  const viewModeStorageKey = () => `share-viewmode-${props.token}`

  const viewMode = createMemo(() => {
    void shareViewModeTick()
    return useBrowserViewModeStore
      .getState()
      .getViewMode(viewModeStorageKey(), props.shareInfo.adminViewMode)
  })

  function setViewMode(mode: 'list' | 'grid') {
    useBrowserViewModeStore.getState().setViewMode(viewModeStorageKey(), mode)
    setShareViewModeTick((n) => n + 1)
  }

  const editableFoldersForMove = createMemo(() =>
    props.shareInfo.path ? [props.shareInfo.path] : [],
  )

  const renameTargetExists = createMemo(() => {
    const item = renamingItem()
    const name = renameNewName().trim()
    if (!item || !name || renameItemMutation.isPending) return false
    return files().some((f) => f.path !== item.path && f.name.toLowerCase() === name.toLowerCase())
  })

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
    const unsub = useBrowserViewModeStore.subscribe(() => setShareViewModeTick((n) => n + 1))
    onCleanup(() => unsub())
  })

  onCleanup(() => {
    useMediaPlayer.getState().clearShareContext()
  })

  function dismissMenu() {
    setRowMenu(null)
  }

  const shareBreadcrumbMenuActions = createMemo(() => {
    const m = breadcrumbMenu()
    if (!m) {
      return { showOpenInNewTab: false, showOpenInWorkspace: false, showDownloadAsZip: false }
    }
    return {
      showOpenInNewTab: true,
      showOpenInWorkspace: props.shareInfo.isDirectory,
      showDownloadAsZip: true,
    }
  })

  function shareBreadcrumbAsFolder(m: BreadcrumbMenuTarget): FileItem {
    return {
      name: m.displayName,
      path: m.serverPath,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
    }
  }

  function handleShareBreadcrumbOpenInNewTab() {
    const m = breadcrumbMenu()
    if (!m) return
    const sharePathNorm = props.shareInfo.path.replace(/\\/g, '/')
    const subPath =
      m.serverPath === sharePathNorm ? '' : stripSharePrefix(m.serverPath, props.shareInfo.path)
    const params = new URLSearchParams()
    if (subPath) params.set('dir', subPath)
    const query = params.toString()
    window.open(query ? `/share/${props.token}?${query}` : `/share/${props.token}`, '_blank')
  }

  function handleShareBreadcrumbOpenInWorkspace() {
    const m = breadcrumbMenu()
    if (!m || !props.shareInfo.isDirectory) return
    const sharePathNorm = props.shareInfo.path.replace(/\\/g, '/')
    const subPath =
      m.serverPath === sharePathNorm ? '' : stripSharePrefix(m.serverPath, props.shareInfo.path)
    const params = new URLSearchParams()
    if (subPath) params.set('dir', subPath)
    const query = params.toString()
    window.open(
      query ? `/share/${props.token}/workspace?${query}` : `/share/${props.token}/workspace`,
      '_blank',
    )
  }

  function handleShareBreadcrumbDownloadZip() {
    const m = breadcrumbMenu()
    if (!m) return
    handleDownload(shareBreadcrumbAsFolder(m))
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

  function openContextRename(file: FileItem) {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRename(true)
    dismissMenu()
  }

  function cancelRename() {
    setShowRename(false)
    setRenamingItem(null)
    setRenameNewName('')
    renameItemMutation.reset()
  }

  function submitRename() {
    const item = renamingItem()
    const newName = renameNewName().trim()
    if (!item || !newName || newName === item.name || renameTargetExists()) return
    const oldRel = stripSharePrefix(item.path, props.shareInfo.path)
    const parts = oldRel.split('/').filter(Boolean)
    const parent = parts.slice(0, -1).join('/')
    const newRel = parent ? `${parent}/${newName}` : newName
    renameItemMutation.mutate(
      { oldPath: oldRel, newPath: newRel },
      { onSuccess: () => cancelRename() },
    )
  }

  function openContextMove(file: FileItem) {
    setMoveTarget(file)
    moveItemMutation.reset()
    dismissMenu()
  }

  function closeMoveDialog() {
    setMoveTarget(null)
    moveItemMutation.reset()
  }

  function confirmMoveTo(destDir: string) {
    const target = moveTarget()
    if (!target) return
    const sourceRel = stripSharePrefix(target.path, props.shareInfo.path)
    const baseName = sourceRel.split('/').filter(Boolean).pop()!
    const newPath = destDir ? `${destDir}/${baseName}` : baseName
    moveItemMutation.mutate(
      { oldPath: sourceRel, newPath: newPath },
      { onSuccess: () => closeMoveDialog() },
    )
  }

  const moveDialogRelPath = createMemo(() => {
    const t = moveTarget()
    if (!t) return ''
    return stripSharePrefix(t.path, props.shareInfo.path)
  })

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')

  async function uploadFilesToServer(files: File[]) {
    if (files.length === 0 || !canUpload()) return
    const targetDir = currentSubDir()
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const formData = new FormData()
      formData.append('targetDir', targetDir)
      for (const file of files) {
        formData.append('files', file, file.name)
      }
      const res = await fetch(`/api/share/${props.token}/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        const message = data?.error || `Upload failed (${res.status})`
        setUploadToast({ kind: 'error', message })
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
      setUploadToast({ kind: 'success' })
      window.setTimeout(() => setUploadToast({ kind: 'hidden' }), 2000)
    } catch (err) {
      setUploadToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  function isOsFileUploadDrag(e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    return !!(dtr && dtr.types.includes('Files'))
  }

  function onExternalUploadDragEnter(e: globalThis.DragEvent) {
    if (!canUpload() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    externalUploadDragDepth++
    if (externalUploadDragDepth === 1) setExternalUploadDragOver(true)
  }

  function onExternalUploadDragLeave(e: globalThis.DragEvent) {
    if (!canUpload()) return
    e.preventDefault()
    externalUploadDragDepth--
    if (externalUploadDragDepth <= 0) {
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }
  }

  function onExternalUploadDragOver(e: globalThis.DragEvent) {
    if (!canUpload() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    const dtr = e.dataTransfer
    if (dtr) dtr.dropEffect = 'copy'
  }

  async function onExternalUploadDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    externalUploadDragDepth = 0
    setExternalUploadDragOver(false)
    if (!canUpload()) return
    const dtr = e.dataTransfer
    if (!dtr || dtr.files.length === 0) return
    const dropped = await collectDroppedUploadFiles(dtr)
    if (dropped.length > 0) void uploadFilesToServer(dropped)
  }

  return (
    <>
      <MainMediaPlayers
        shareContext={shareContext()}
        shareCanEdit={shareCanEdit()}
        editableFolders={[]}
      />
      <div class='min-h-screen' data-testid='share-file-browser'>
        <BreadcrumbContextMenu
          target={breadcrumbMenu}
          onDismiss={() => setBreadcrumbMenu(null)}
          showOpenInNewTab={shareBreadcrumbMenuActions().showOpenInNewTab}
          onOpenInNewTab={handleShareBreadcrumbOpenInNewTab}
          showOpenInWorkspace={shareBreadcrumbMenuActions().showOpenInWorkspace}
          onOpenInWorkspace={handleShareBreadcrumbOpenInWorkspace}
          showDownloadAsZip={shareBreadcrumbMenuActions().showDownloadAsZip}
          onDownloadAsZip={handleShareBreadcrumbDownloadZip}
        />
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
                  <Show when={shareCanEdit() && !ctx.file.isVirtual}>
                    <button
                      type='button'
                      data-slot='context-menu-item'
                      class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                      role='menuitem'
                      onClick={() => openContextRename(ctx.file)}
                    >
                      Rename
                    </button>
                  </Show>
                  <Show when={shareCanEdit() && !ctx.file.isVirtual}>
                    <button
                      type='button'
                      data-slot='context-menu-item'
                      class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                      role='menuitem'
                      onClick={() => openContextMove(ctx.file)}
                    >
                      Move to…
                    </button>
                  </Show>
                  <Show when={ctx.file.isDirectory && !ctx.file.isVirtual}>
                    <button
                      type='button'
                      data-slot='context-menu-item'
                      class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                      role='menuitem'
                      onClick={() => {
                        const sharePathNorm = props.shareInfo.path.replace(/\\/g, '/')
                        const pathNorm = ctx.file.path.replace(/\\/g, '/')
                        const subPath =
                          pathNorm === sharePathNorm
                            ? ''
                            : stripSharePrefix(ctx.file.path, props.shareInfo.path)
                        const params = new URLSearchParams()
                        if (subPath) params.set('dir', subPath)
                        const query = params.toString()
                        window.open(
                          query
                            ? `/share/${props.token}/workspace?${query}`
                            : `/share/${props.token}/workspace`,
                          '_blank',
                        )
                        dismissMenu()
                      }}
                    >
                      <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                      Open in Workspace
                    </button>
                  </Show>
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

        <RenameDialog
          isOpen={showRename()}
          itemName={renamingItem()?.name ?? ''}
          newName={renameNewName()}
          onNewNameChange={setRenameNewName}
          onRename={submitRename}
          onCancel={cancelRename}
          isPending={renameItemMutation.isPending}
          error={renameItemMutation.error as Error | undefined}
          nameExists={renameTargetExists()}
          isDirectory={renamingItem()?.isDirectory ?? false}
        />

        <Show when={moveTarget()}>
          <MoveToDialog
            onClose={closeMoveDialog}
            fileName={moveTarget()!.name}
            filePath={moveDialogRelPath()}
            onConfirm={confirmMoveTo}
            isPending={moveItemMutation.isPending}
            error={moveItemMutation.error as Error | undefined}
            editableFolders={editableFoldersForMove()}
            shareToken={props.token}
            shareRootPath={props.shareInfo.path}
          />
        </Show>

        <Show when={showCreateFolder()}>
          <div
            class='fixed inset-0 z-[600000] flex items-center justify-center bg-black/50 p-4'
            role='presentation'
            onClick={() => setShowCreateFolder(false)}
          >
            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='share-create-folder-title'
              class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id='share-create-folder-title' class='text-lg font-semibold'>
                Create folder
              </h2>
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
              aria-labelledby='share-create-file-title'
              class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id='share-create-file-title' class='text-lg font-semibold'>
                Create file
              </h2>
              <form class='mt-4 space-y-4' onSubmit={submitCreateFile}>
                <input
                  type='text'
                  class='border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm'
                  value={newItemName()}
                  placeholder='File name (e.g., notes.txt)'
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
                          data-breadcrumb-segment={index() === 0 ? 'share-root' : 'crumb'}
                          data-breadcrumb-path={crumb.path}
                          class={cn(
                            'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            index() === breadcrumbs().length - 1
                              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                              : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                          )}
                          onClick={() => navigateToFolder(crumb.path || null)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const shareNorm = props.shareInfo.path.replace(/\\/g, '/')
                            const subDir = crumb.path
                            const serverPath = subDir ? `${shareNorm}/${subDir}` : shareNorm
                            setBreadcrumbMenu({
                              x: e.clientX,
                              y: e.clientY,
                              serverPath,
                              displayName: crumb.name,
                              isHome: index() === 0,
                            })
                          }}
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
                <div class='flex flex-wrap items-center justify-end gap-1'>
                  <Show when={canUpload()}>
                    <div class='flex items-center gap-1'>
                      <button
                        type='button'
                        title='Create new file'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
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
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                        onClick={() => {
                          setNewItemName('')
                          setShowCreateFolder(true)
                        }}
                      >
                        <FolderPlus class='h-4 w-4' stroke-width={2} />
                      </button>
                      <UploadMenu
                        mode='MediaServer'
                        disabled={isUploading()}
                        onUpload={(files) => void uploadFilesToServer(files)}
                      />
                      <div class='bg-border mx-1 h-5 w-px shrink-0' />
                    </div>
                  </Show>
                  <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
                  <ThemeSwitcher />
                </div>
              </div>
            </div>
            <div
              class='relative flex min-h-0 flex-1 flex-col overflow-hidden'
              onDragEnter={onExternalUploadDragEnter}
              onDragLeave={onExternalUploadDragLeave}
              onDragOver={onExternalUploadDragOver}
              onDrop={(e) => void onExternalUploadDrop(e)}
            >
              <Show when={externalUploadDragOver() && canUpload()}>
                <div class='pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10'>
                  <p class='text-primary text-sm font-medium'>Drop files to upload</p>
                </div>
              </Show>
              <Show when={filesQuery.isError}>
                <div class='p-4'>
                  <p class='text-destructive text-sm'>Failed to load files.</p>
                </div>
              </Show>
              <Switch>
                <Match when={viewMode() === 'grid'}>
                  <div class='px-4 py-4'>
                    <div class='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'>
                      <Show when={currentSubDir()}>
                        <div
                          class='ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50'
                          onClick={handleParentDirectory}
                          role='button'
                          tabindex={0}
                        >
                          <div class='flex aspect-video flex-col items-center justify-center bg-muted/80 p-4'>
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
                            class='ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50'
                            onClick={() => handleFileClick(file)}
                            onContextMenu={(e) => openRowMenu(e, file)}
                            {...createLongPressContextMenuHandlers()}
                            role='button'
                            tabindex={0}
                          >
                            <div class='relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                              <div class='text-muted-foreground'>
                                {gridHeroIcon(file, EMPTY_FILE_ICON_CONTEXT)}
                              </div>
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
                  </div>
                </Match>
                <Match when={viewMode() === 'list'}>
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
                                {...createLongPressContextMenuHandlers()}
                              >
                                <td class='w-12 p-2 align-middle'>
                                  <div class='flex items-center justify-center'>
                                    {fileIcon(file)}
                                  </div>
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
                          <Show when={showInlineCreate()}>
                            <tr class='border-t border-border' onClick={(e) => e.stopPropagation()}>
                              <td class='p-0' colspan={3}>
                                <div class='grid grid-cols-2 gap-2 px-2 py-1.5'>
                                  <div class='flex min-w-0 flex-col gap-1'>
                                    <Show
                                      when={inlineMode() === 'file'}
                                      fallback={
                                        <button
                                          type='button'
                                          class='border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground box-border flex h-7 min-h-7 max-h-7 w-full items-center justify-center gap-1.5 rounded-none border border-dashed px-2 py-0 text-xs leading-none transition-colors'
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setInlineName('')
                                            setInlineMode('file')
                                          }}
                                        >
                                          <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
                                          New file
                                        </button>
                                      }
                                    >
                                      <input
                                        type='text'
                                        ref={(el) => {
                                          inlineFileInputEl = el ?? undefined
                                        }}
                                        class={`border-input bg-background dark:bg-input/30 box-border m-0 h-7 min-h-7 max-h-7 w-full rounded-none border px-2 py-0 text-xs leading-none shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                                          inlineFileExists()
                                            ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                                            : createFileMutation.isError
                                              ? 'border-destructive ring-2 ring-destructive/30'
                                              : ''
                                        }`}
                                        placeholder='File name (e.g. notes.md)'
                                        value={inlineName()}
                                        disabled={createFileMutation.isPending}
                                        onInput={(e) =>
                                          setInlineName((e.currentTarget as HTMLInputElement).value)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') submitInlineFile()
                                          else if (e.key === 'Escape') resetInlineCreate()
                                        }}
                                        onBlur={() => resetInlineCreate()}
                                      />
                                      <Show when={inlineFileExists()}>
                                        <div class='flex items-start gap-1.5 rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                                          <AlertCircle
                                            class='mt-0.5 h-3.5 w-3.5 shrink-0'
                                            stroke-width={2}
                                          />
                                          <span>A file with this name already exists.</span>
                                        </div>
                                      </Show>
                                      <Show
                                        when={createFileMutation.isError && !inlineFileExists()}
                                      >
                                        <div class='border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs'>
                                          <AlertCircle
                                            class='mt-0.5 h-3.5 w-3.5 shrink-0'
                                            stroke-width={2}
                                          />
                                          <span>
                                            {(createFileMutation.error as Error)?.message}
                                          </span>
                                        </div>
                                      </Show>
                                    </Show>
                                  </div>
                                  <div class='flex min-w-0 flex-col gap-1'>
                                    <Show
                                      when={inlineMode() === 'folder'}
                                      fallback={
                                        <button
                                          type='button'
                                          class='border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground box-border flex h-7 min-h-7 max-h-7 w-full items-center justify-center gap-1.5 rounded-none border border-dashed px-2 py-0 text-xs leading-none transition-colors'
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setInlineName('')
                                            setInlineMode('folder')
                                          }}
                                        >
                                          <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
                                          New folder
                                        </button>
                                      }
                                    >
                                      <input
                                        type='text'
                                        ref={(el) => {
                                          inlineFolderInputEl = el ?? undefined
                                        }}
                                        class={`border-input bg-background dark:bg-input/30 box-border m-0 h-7 min-h-7 max-h-7 w-full rounded-none border px-2 py-0 text-xs leading-none shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                                          inlineFolderExists()
                                            ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                                            : createFolderMutation.isError
                                              ? 'border-destructive ring-2 ring-destructive/30'
                                              : ''
                                        }`}
                                        placeholder='Folder name'
                                        value={inlineName()}
                                        disabled={createFolderMutation.isPending}
                                        onInput={(e) =>
                                          setInlineName((e.currentTarget as HTMLInputElement).value)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') submitInlineFolder()
                                          else if (e.key === 'Escape') resetInlineCreate()
                                        }}
                                        onBlur={() => resetInlineCreate()}
                                      />
                                      <Show when={inlineFolderExists()}>
                                        <div class='flex items-start gap-1.5 rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                                          <AlertCircle
                                            class='mt-0.5 h-3.5 w-3.5 shrink-0'
                                            stroke-width={2}
                                          />
                                          <span>A folder with this name already exists.</span>
                                        </div>
                                      </Show>
                                      <Show
                                        when={createFolderMutation.isError && !inlineFolderExists()}
                                      >
                                        <div class='border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs'>
                                          <AlertCircle
                                            class='mt-0.5 h-3.5 w-3.5 shrink-0'
                                            stroke-width={2}
                                          />
                                          <span>
                                            {(createFolderMutation.error as Error)?.message}
                                          </span>
                                        </div>
                                      </Show>
                                    </Show>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </Show>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </div>
      <UploadToastStack
        state={uploadToast}
        onDismissError={() => setUploadToast({ kind: 'hidden' })}
      />
    </>
  )
}
