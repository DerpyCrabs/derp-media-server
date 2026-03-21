import {
  getFileDragData,
  hasFileDragData,
  isCompatibleSource,
  setFileDragData,
} from '@/lib/file-drag-data'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { GlobalSettings } from '@/lib/use-settings'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'
import { extractPasteDataFromClipboardData } from '@/lib/extract-paste-data'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { VIRTUAL_FOLDERS, isVirtualFolderPath } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'
import type { PasteData } from '@/lib/paste-data'
import { MediaType, type FileItem } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { cn, getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Search from 'lucide-solid/icons/search'
import Star from 'lucide-solid/icons/star'
import Upload from 'lucide-solid/icons/upload'
import Eye from 'lucide-solid/icons/eye'
import Share2 from 'lucide-solid/icons/share-2'
import LinkIcon from 'lucide-solid/icons/link'
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js'
import type { FileIconContext } from './lib/use-file-icon'
import { fileItemIcon, gridHeroIcon } from './lib/use-file-icon'
import { createUrlSearchParamsMemo, useBrowserHistory } from './browser-history'
import type { BreadcrumbMenuTarget } from './file-browser/BreadcrumbContextMenu'
import { Breadcrumbs } from './file-browser/Breadcrumbs'
import { FileBrowserModalLayer } from './file-browser/FileBrowserModalLayer'
import { KbDashboard } from './file-browser/KbDashboard'
import { KbSearchResults } from './file-browser/KbSearchResults'
import { navigateToFolder } from './file-browser/navigate-folder'
import { useFileRowContextMenu } from './file-browser/use-file-row-context-menu'
import { UploadMenu } from './file-browser/UploadMenu'
import type { AuthConfig, UploadToastState } from './file-browser/types'
import { useInlineModeInputFocus } from './file-browser/use-inline-mode-input-focus'
import { ViewModeToggle } from './file-browser/ViewModeToggle'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { useStoreSync } from './lib/solid-store-sync'
import { useViewStats } from './lib/use-view-stats'
import { createLongPressContextMenuHandlers } from './lib/long-press-context-menu'
import { playFile, viewFile } from './lib/url-state-actions'

export function FileBrowser() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const queryClient = useQueryClient()
  useAdminEventsStream()

  const currentPath = createMemo(() => urlSearchParams().get('dir') ?? '')

  const playingParam = createMemo(() => urlSearchParams().get('playing'))

  const playingPath = createMemo(() => playingParam() ?? '')

  const isAudioPlayingBar = createMemo(() => {
    const p = playingPath()
    if (!p) return false
    const ext = p.split('.').pop()?.toLowerCase()
    const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
    return audioExtensions.includes(ext || '')
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
  const pasteExistingLowerNames = createMemo(() => files().map((f) => f.name.toLowerCase()))

  const knowledgeBases = createMemo(() => settingsQuery.data?.knowledgeBases ?? [])
  const kbRootPath = createMemo(() => getKnowledgeBaseRoot(currentPath(), knowledgeBases()))
  const inKb = createMemo(() => kbRootPath() !== null)
  const customIcons = createMemo(() => settingsQuery.data?.customIcons ?? {})
  const hasEditableFolders = createMemo(() => editableFolders().length > 0)

  const viewStats = useViewStats(() => ({}))
  useDynamicFavicon(() => customIcons(), { getSearch: () => history().search })

  const mediaPlayerTick = useStoreSync(useMediaPlayer)

  const fileIconCtx = createMemo((): FileIconContext => {
    void mediaPlayerTick()
    const st = useMediaPlayer.getState()
    return {
      customIcons: customIcons(),
      knowledgeBases: knowledgeBases(),
      playingPath: playingParam(),
      currentFile: st.currentFile,
      mediaPlayerIsPlaying: st.isPlaying,
      mediaType: st.mediaType,
    }
  })

  const [searchQuery, setSearchQuery] = createSignal('')
  const [debouncedSearch, setDebouncedSearch] = createSignal('')
  const [searchPopoverOpen, setSearchPopoverOpen] = createSignal(false)
  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const [breadcrumbMenu, setBreadcrumbMenu] = createSignal<BreadcrumbMenuTarget | null>(null)

  createEffect(() => {
    const q = searchQuery()
    const id = window.setTimeout(() => setDebouncedSearch(q), 300)
    onCleanup(() => clearTimeout(id))
  })

  createEffect(
    on(
      currentPath,
      () => {
        batch(() => {
          setSearchQuery('')
          setDebouncedSearch('')
          setSearchPopoverOpen(false)
          setInlineMode(null)
          setInlineName('')
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!searchPopoverOpen()) return
    const onDoc = (e: MouseEvent) => {
      const root = document.querySelector('[data-kb-search-root]')
      if (root?.contains(e.target as Node)) return
      setSearchPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  const kbSearchQuery = useQuery(() => ({
    queryKey: queryKeys.kbSearch(kbRootPath()!, debouncedSearch()),
    queryFn: () =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(kbRootPath()!)}&q=${encodeURIComponent(debouncedSearch())}`,
      ),
    enabled: !!kbRootPath() && debouncedSearch().trim().length > 0,
  }))

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
  const [draggedPath, setDraggedPath] = createSignal<string | null>(null)
  const [dragOverPath, setDragOverPath] = createSignal<string | null>(null)
  const [enableDrag, setEnableDrag] = createSignal(false)
  let externalUploadDragDepth = 0
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  const [pasteData, setPasteData] = createSignal<PasteData | null>(null)
  const [showPasteDialog, setShowPasteDialog] = createSignal(false)
  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  let inlineFileInputEl: HTMLInputElement | undefined
  let inlineFolderInputEl: HTMLInputElement | undefined

  useInlineModeInputFocus(
    inlineMode,
    () => inlineFileInputEl,
    () => inlineFolderInputEl,
  )

  onMount(() => {
    setEnableDrag(typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches)
  })

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

  const pasteMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; content?: string; base64Content?: string }) =>
      post('/api/files/create', {
        type: 'file',
        path: vars.path,
        content: vars.content,
        base64Content: vars.base64Content,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      setShowPasteDialog(false)
      setPasteData(null)
    },
  }))

  function closePasteDialog() {
    setShowPasteDialog(false)
    setPasteData(null)
    pasteMutation.reset()
  }

  async function handlePasteEvent(e: ClipboardEvent) {
    if (!isEditable()) return
    e.preventDefault()
    const data = await extractPasteDataFromClipboardData(e.clipboardData)
    if (!data) return
    setPasteData(data)
    setShowPasteDialog(true)
  }

  function handlePasteFileSubmit(fileName: string) {
    const pd = pasteData()
    if (!pd) return
    const rel = currentPath() ? `${currentPath()}/${fileName}` : fileName
    if (pd.type === 'image') {
      pasteMutation.mutate({ path: rel, base64Content: pd.content })
    } else if (pd.type === 'file') {
      if (pd.isTextContent) {
        pasteMutation.mutate({ path: rel, content: pd.content })
      } else {
        pasteMutation.mutate({ path: rel, base64Content: pd.content })
      }
    } else {
      pasteMutation.mutate({ path: rel, content: pd.content })
    }
  }

  const parentDirForDrop = createMemo(() => {
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    return parts.slice(0, -1).join('/')
  })

  const canDropOnParent = createMemo(
    () =>
      isEditable() &&
      !!currentPath() &&
      isPathEditable(parentDirForDrop() || '', editableFolders()),
  )

  function canDropOn(targetPath: string, sourcePath?: string | null) {
    const src = sourcePath ?? draggedPath()
    if (!src || src === targetPath) return false
    if (targetPath.startsWith(src + '/')) return false
    return true
  }

  function parentDirFromCurrent(): string {
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }

  function handleMoveFileFromDrag(sourcePath: string, destinationDir: string) {
    const fileName = sourcePath.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveMutation.mutate({ oldPath: sourcePath, newPath })
  }

  const allowMoveFile = createMemo(() => (isEditable() ? handleMoveFileFromDrag : undefined))

  function parentRowDragOver(e: globalThis.DragEvent) {
    const mv = allowMoveFile()
    const dtr = e.dataTransfer
    if (!mv || !canDropOnParent() || !dtr || (!draggedPath() && !hasFileDragData(dtr))) return
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
    const dest = parentDirFromCurrent()
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
      isCompatibleSource({ sourceKind: 'local', sourceToken: undefined }, data) &&
      canDropOn(dest, data.path)
    ) {
      mv(data.path, dest)
    }
  }

  function onFileDragStart(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!dtr || !enableDrag() || !isPathEditable(file.path, editableFolders()) || !allowMoveFile())
      return
    setFileDragData(dtr, {
      path: file.path,
      isDirectory: file.isDirectory,
      sourceKind: 'local',
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
    if (!isPathEditable(file.path, editableFolders())) return
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

  function handleFolderRowDragOver(path: string, e: globalThis.DragEvent) {
    const file = files().find((x) => x.path === path)
    if (file?.isDirectory) onFolderDragOver(file, e)
  }

  function handleFolderRowDragLeave(path: string, e: globalThis.DragEvent) {
    const file = files().find((x) => x.path === path)
    if (file?.isDirectory) onFolderDragLeave(file, e)
  }

  function handleFolderRowDrop(path: string, e: globalThis.DragEvent) {
    const file = files().find((x) => x.path === path)
    if (file?.isDirectory) onFolderDrop(file, e)
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
        isCompatibleSource({ sourceKind: 'local', sourceToken: undefined }, data) &&
        canDropOn(file.path, data.path)
      ) {
        mv(data.path, file.path)
      }
    }
  }

  const copyMutation = useMutation(() => ({
    mutationFn: (vars: { sourcePath: string; destinationDir: string }) =>
      post('/api/files/copy', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const knowledgeBaseMutation = useMutation(() => ({
    mutationFn: (filePath: string) => post('/api/settings/knowledgeBase', { filePath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const setCustomIconMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; iconName: string }) => post('/api/settings/icon', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const removeCustomIconMutation = useMutation(() => ({
    mutationFn: (path: string) => post('/api/settings/icon/remove', { path }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
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

  const showInlineCreate = createMemo(() => isEditable() && inKb())

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
    const base = currentPath() ? `${currentPath()}/${stem}` : stem
    const defaultExt = inKb() ? '.md' : '.txt'
    const finalPath = base.includes('.') ? base : `${base}${defaultExt}`
    createFileMutation.mutate(
      { type: 'file', path: finalPath, content: '' },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFileMutation.reset()
        },
      },
    )
  }

  function submitInlineFolder() {
    const name = inlineName().trim()
    if (!name || inlineFolderExists() || !showInlineCreate()) return
    const folderPath = currentPath() ? `${currentPath()}/${name}` : name
    createFolderMutation.mutate(
      { type: 'folder', path: folderPath },
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

  function isOsFileUploadDrag(e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    return !!(dtr && dtr.types.includes('Files') && !hasFileDragData(dtr))
  }

  function onExternalUploadDragEnter(e: globalThis.DragEvent) {
    if (!isEditable() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    externalUploadDragDepth++
    if (externalUploadDragDepth === 1) setExternalUploadDragOver(true)
  }

  function onExternalUploadDragLeave(e: globalThis.DragEvent) {
    if (!isEditable()) return
    e.preventDefault()
    externalUploadDragDepth--
    if (externalUploadDragDepth <= 0) {
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }
  }

  function onExternalUploadDragOver(e: globalThis.DragEvent) {
    if (!isEditable() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    const dtr = e.dataTransfer
    if (dtr) dtr.dropEffect = 'copy'
  }

  async function onExternalUploadDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    externalUploadDragDepth = 0
    setExternalUploadDragOver(false)
    if (!isEditable()) return
    const dtr = e.dataTransfer
    if (!dtr || dtr.files.length === 0) return
    const files = await collectDroppedUploadFiles(dtr)
    if (files.length > 0) void uploadFilesToServer(files, currentPath())
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

  function breadcrumbAsFolderItem(m: BreadcrumbMenuTarget): FileItem {
    const p = m.serverPath
    return {
      name: m.displayName,
      path: p,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      isVirtual: isVirtualFolderPath(p),
    }
  }

  const breadcrumbMenuActions = createMemo(() => {
    const m = breadcrumbMenu()
    if (!m) {
      return { showOpenInNewTab: false, showOpenInWorkspace: false, showSetIcon: false }
    }
    if (m.isHome) {
      return { showOpenInNewTab: true, showOpenInWorkspace: true, showSetIcon: false }
    }
    const virt = isVirtualFolderPath(m.serverPath)
    return {
      showOpenInNewTab: !virt,
      showOpenInWorkspace: !virt,
      showSetIcon: !virt,
    }
  })

  function handleBreadcrumbCrumbContextMenu(
    e: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) {
    setBreadcrumbMenu({
      x: e.clientX,
      y: e.clientY,
      serverPath: info.navigatePath.replace(/\\/g, '/'),
      displayName: info.displayName,
      isHome: info.isHome,
    })
  }

  function handleBreadcrumbOpenInNewTab() {
    const m = breadcrumbMenu()
    if (!m) return
    if (m.isHome) {
      window.open(`${window.location.origin}${window.location.pathname || '/'}`, '_blank')
      return
    }
    handleContextOpenInNewTab(breadcrumbAsFolderItem(m))
  }

  function handleBreadcrumbOpenInWorkspace() {
    const m = breadcrumbMenu()
    if (!m) return
    if (m.isHome) {
      window.open('/workspace', '_blank')
      return
    }
    handleContextOpenInWorkspace(breadcrumbAsFolderItem(m))
  }

  function handleBreadcrumbSetIcon() {
    const m = breadcrumbMenu()
    if (!m || m.isHome || isVirtualFolderPath(m.serverPath)) return
    setIconEditTarget(breadcrumbAsFolderItem(m))
  }

  function handleContextDownload(file: FileItem) {
    const link = document.createElement('a')
    link.href = `/api/files/download?path=${encodeURIComponent(file.path)}`
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function handleContextOpenInNewTab(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const url = `${window.location.origin}${window.location.pathname || '/'}?${params.toString()}`
    window.open(url, '_blank')
  }

  function handleContextOpenInWorkspace(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/workspace?${query}` : '/workspace', '_blank')
  }

  function handleContextToggleFavorite(file: FileItem) {
    favoriteMutation.mutate({ filePath: file.path })
  }

  function isRowFavorite(file: FileItem) {
    return favoriteSet().has(file.path)
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

    viewStats.incrementView(file.path)
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

  function handleKbResultClick(filePath: string) {
    setSearchQuery('')
    setSearchPopoverOpen(false)
    viewFile(filePath, currentPath())
  }

  function handleContextToggleKnowledgeBase(file: FileItem) {
    knowledgeBaseMutation.mutate(file.path.replace(/\\/g, '/'))
  }

  function handleContextSetIcon(file: FileItem) {
    setIconEditTarget(file)
  }

  function handleSaveCustomIcon(iconName: string | null) {
    const t = iconEditTarget()
    if (!t) return
    const p = t.path.replace(/\\/g, '/')
    if (iconName) {
      void setCustomIconMutation.mutateAsync({ path: p, iconName })
    } else {
      void removeCustomIconMutation.mutateAsync(p)
    }
  }

  function isRowKnowledgeBase(file: FileItem) {
    return file.isDirectory && knowledgeBases().includes(file.path.replace(/\\/g, '/'))
  }

  const showKbSearchResults = createMemo(() => inKb() && searchQuery().trim().length > 0)

  return (
    <>
      <MainMediaPlayers editableFolders={editableFolders()} knowledgeBases={knowledgeBases()} />
      <div
        class={cn('flex min-h-screen flex-col', isAudioPlayingBar() && 'pb-12')}
        data-testid='media-chrome-pad-root'
      >
        <div
          data-testid='file-browser'
          class='flex min-h-0 flex-1 flex-col'
          tabIndex={0}
          onPaste={(e) => void handlePasteEvent(e)}
        >
          <div class='container mx-auto lg:p-4'>
            <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none lg:rounded-xl py-0 text-sm shadow-xs ring-1'>
              <div class='shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'>
                <div class='flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'>
                  <Breadcrumbs
                    currentPath={currentPath()}
                    onNavigate={handleBreadcrumbNavigate}
                    onCrumbContextMenu={handleBreadcrumbCrumbContextMenu}
                  />
                  <Show when={inKb()}>
                    <div class='order-last flex basis-full items-center justify-end md:order-0 md:basis-auto md:justify-start'>
                      <div class='relative' data-kb-search-root>
                        <button
                          type='button'
                          aria-label='Open search'
                          class='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                          onClick={() => setSearchPopoverOpen(!searchPopoverOpen())}
                        >
                          <Search class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                        </button>
                        <Show when={searchPopoverOpen()}>
                          <div class='absolute right-0 top-full z-50 mt-1.5 w-72 rounded-md border border-border bg-popover p-2 shadow-lg outline-none'>
                            <input
                              type='search'
                              placeholder='Search notes...'
                              class='border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
                              value={searchQuery()}
                              onInput={(e) => setSearchQuery(e.currentTarget.value)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  </Show>
                  <div class='flex items-center gap-1'>
                    <Show when={isEditable()}>
                      <button
                        type='button'
                        title='Create new folder'
                        aria-label='New folder'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                        onClick={() => openCreateFolder()}
                      >
                        <FolderPlus class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                      </button>
                      <button
                        type='button'
                        title='Create new file'
                        aria-label='New file'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
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
                    <ThemeSwitcher />
                  </div>
                </div>
              </div>

              <div
                class='relative flex flex-col min-h-0 flex-1 overflow-hidden'
                data-testid='upload-drop-zone'
                onDragEnter={onExternalUploadDragEnter}
                onDragLeave={onExternalUploadDragLeave}
                onDragOver={onExternalUploadDragOver}
                onDrop={(e) => void onExternalUploadDrop(e)}
              >
                <Show when={filesQuery.isError}>
                  <div class='p-4'>
                    <p class='text-destructive text-sm'>Failed to load files.</p>
                  </div>
                </Show>

                <Show
                  when={showKbSearchResults()}
                  fallback={
                    <>
                      <Show when={inKb() && !!currentPath()}>
                        <KbDashboard scopePath={currentPath()} onFileClick={handleKbResultClick} />
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
                                    <p class='text-center text-xs text-muted-foreground'>
                                      Parent Folder
                                    </p>
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
                                      {...createLongPressContextMenuHandlers()}
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
                                        <Show when={!file.isDirectory}>
                                          <div
                                            class={cn(
                                              'absolute top-1.5 right-1.5 z-10 flex items-center gap-1',
                                              viewStats.getViewCount(file.path) > 0 ||
                                                viewStats.getShareViewCount(file.path) > 0
                                                ? ''
                                                : 'hidden',
                                            )}
                                          >
                                            <Show when={viewStats.getViewCount(file.path) > 0}>
                                              <div
                                                class='flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
                                                title={`${viewStats.getViewCount(file.path)} views`}
                                              >
                                                <Eye
                                                  class='h-3 w-3 text-muted-foreground'
                                                  stroke-width={2}
                                                />
                                                <span class='text-xs font-medium text-muted-foreground'>
                                                  {viewStats.getViewCount(file.path)}
                                                </span>
                                              </div>
                                            </Show>
                                            <Show when={viewStats.getShareViewCount(file.path) > 0}>
                                              <div
                                                class='flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
                                                title={`${viewStats.getShareViewCount(file.path)} shared views`}
                                              >
                                                <Share2
                                                  class='h-3 w-3 text-primary/70'
                                                  stroke-width={2}
                                                />
                                                <span class='text-xs font-medium text-primary/70'>
                                                  {viewStats.getShareViewCount(file.path)}
                                                </span>
                                              </div>
                                            </Show>
                                          </div>
                                        </Show>
                                        <div
                                          class='text-muted-foreground'
                                          {...(isRowKnowledgeBase(file)
                                            ? { 'data-kb-root-icon': '' }
                                            : {})}
                                        >
                                          {gridHeroIcon(file, fileIconCtx())}
                                        </div>
                                      </div>
                                      <div class='flex flex-col gap-1 p-3'>
                                        <p class='truncate text-sm font-medium' title={file.name}>
                                          {file.name}
                                          <Show when={sharedPathSet().has(file.path)}>
                                            <LinkIcon
                                              class='ml-1 inline h-3 w-3 text-primary opacity-70'
                                              aria-hidden='true'
                                              stroke-width={2}
                                            />
                                          </Show>
                                        </p>
                                        <Show
                                          when={isVirtualFolder() && !file.isDirectory}
                                          fallback={
                                            <div class='flex items-center justify-end text-xs text-muted-foreground'>
                                              <span>
                                                {file.isDirectory ? '' : formatFileSize(file.size)}
                                              </span>
                                            </div>
                                          }
                                        >
                                          <p
                                            class='truncate text-xs text-muted-foreground'
                                            title={
                                              file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'
                                            }
                                          >
                                            {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
                                          </p>
                                        </Show>
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
                                      class={cn(
                                        'border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none',
                                        dragOverPath() === '__parent__' ? 'bg-primary/20' : '',
                                      )}
                                      onClick={handleParentDirectory}
                                      onDragOver={
                                        allowMoveFile() && canDropOnParent()
                                          ? parentRowDragOver
                                          : undefined
                                      }
                                      onDragLeave={
                                        allowMoveFile() && canDropOnParent()
                                          ? parentRowDragLeave
                                          : undefined
                                      }
                                      onDrop={
                                        allowMoveFile() && canDropOnParent()
                                          ? parentRowDrop
                                          : undefined
                                      }
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
                                      const canDragRow =
                                        enableDrag() &&
                                        isPathEditable(file.path, editableFolders()) &&
                                        !!allowMoveFile()
                                      return (
                                        <tr
                                          class={cn(
                                            'border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none group',
                                            playingParam() === file.path ? 'bg-primary/10' : '',
                                            file.isDirectory && dragOverPath() === file.path
                                              ? 'bg-primary/20'
                                              : '',
                                            draggedPath() === file.path ? 'opacity-50' : '',
                                          )}
                                          draggable={canDragRow}
                                          onClick={() => handleFileClick(file)}
                                          onContextMenu={(e) =>
                                            fileRowMenu.openRowContextMenu(e, file)
                                          }
                                          {...createLongPressContextMenuHandlers()}
                                          onDragStart={(e) => onFileDragStart(file, e)}
                                          onDragEnd={onFileDragEnd}
                                          onDragOver={(e) => {
                                            if (!file.isDirectory || !allowMoveFile()) return
                                            handleFolderRowDragOver(file.path, e)
                                          }}
                                          onDragLeave={(e) => {
                                            if (!file.isDirectory || !allowMoveFile()) return
                                            handleFolderRowDragLeave(file.path, e)
                                          }}
                                          onDrop={(e) => {
                                            if (!file.isDirectory || !allowMoveFile()) return
                                            handleFolderRowDrop(file.path, e)
                                          }}
                                        >
                                          <td
                                            class='w-12 p-2 align-middle'
                                            {...(isRowKnowledgeBase(file)
                                              ? { 'data-kb-root-icon': '' }
                                              : {})}
                                          >
                                            <div class='flex items-center justify-center'>
                                              {fileItemIcon(file, fileIconCtx())}
                                            </div>
                                          </td>
                                          <td class='p-2 align-middle font-medium'>
                                            <div class='flex items-center gap-2 min-w-0'>
                                              <Show when={!file.isDirectory}>
                                                <button
                                                  type='button'
                                                  class='shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100 transition-opacity inline-flex'
                                                  title={
                                                    isFav()
                                                      ? 'Remove from favorites'
                                                      : 'Add to favorites'
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
                                              <div class='min-w-0 flex-1'>
                                                <span class='block truncate'>
                                                  {file.name}
                                                  <Show when={sharedPathSet().has(file.path)}>
                                                    <LinkIcon
                                                      class='ml-1.5 inline h-3 w-3 text-primary opacity-70'
                                                      aria-hidden='true'
                                                      stroke-width={2}
                                                    />
                                                  </Show>
                                                </span>
                                                <Show when={isVirtualFolder() && !file.isDirectory}>
                                                  <span class='block truncate text-xs text-muted-foreground'>
                                                    {file.path
                                                      .split(/[/\\]/)
                                                      .slice(0, -1)
                                                      .join('/') || '/'}
                                                  </span>
                                                </Show>
                                              </div>
                                            </div>
                                          </td>
                                          <td class='p-2 align-middle text-right text-muted-foreground'>
                                            <div class='flex items-center justify-end gap-2'>
                                              <Show when={!file.isDirectory}>
                                                <Show when={viewStats.getViewCount(file.path) > 0}>
                                                  <div
                                                    class='flex items-center gap-1 text-xs'
                                                    title={`${viewStats.getViewCount(file.path)} views`}
                                                    data-testid='file-view-count'
                                                  >
                                                    <Eye
                                                      class='h-3.5 w-3.5 shrink-0'
                                                      stroke-width={2}
                                                    />
                                                    <span>{viewStats.getViewCount(file.path)}</span>
                                                  </div>
                                                </Show>
                                                <Show
                                                  when={viewStats.getShareViewCount(file.path) > 0}
                                                >
                                                  <div
                                                    class='flex items-center gap-1 text-xs text-primary/70'
                                                    title={`${viewStats.getShareViewCount(file.path)} shared views`}
                                                  >
                                                    <Share2
                                                      class='h-3 w-3 shrink-0'
                                                      stroke-width={2}
                                                    />
                                                    <span>
                                                      {viewStats.getShareViewCount(file.path)}
                                                    </span>
                                                  </div>
                                                </Show>
                                              </Show>
                                              <span class='inline-block w-20 tabular-nums shrink-0'>
                                                {file.isDirectory ? '' : formatFileSize(file.size)}
                                              </span>
                                            </div>
                                          </td>
                                        </tr>
                                      )
                                    }}
                                  </For>
                                  <Show when={showInlineCreate()}>
                                    <tr
                                      class='border-t border-border'
                                      onClick={(e) => e.stopPropagation()}
                                    >
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
                                                  setInlineName(
                                                    (e.currentTarget as HTMLInputElement).value,
                                                  )
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
                                                when={
                                                  createFileMutation.isError && !inlineFileExists()
                                                }
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
                                                  <FolderPlus
                                                    class='h-3.5 w-3.5'
                                                    stroke-width={2}
                                                  />
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
                                                  setInlineName(
                                                    (e.currentTarget as HTMLInputElement).value,
                                                  )
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
                                                  <span>
                                                    A folder with this name already exists.
                                                  </span>
                                                </div>
                                              </Show>
                                              <Show
                                                when={
                                                  createFolderMutation.isError &&
                                                  !inlineFolderExists()
                                                }
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
                    </>
                  }
                >
                  <KbSearchResults
                    results={kbSearchQuery.data?.results ?? []}
                    query={searchQuery()}
                    isLoading={kbSearchQuery.isLoading}
                    currentPath={currentPath()}
                    onResultClick={handleKbResultClick}
                  />
                </Show>
                <Show when={externalUploadDragOver()}>
                  <div class='pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10'>
                    <div class='text-primary flex flex-col items-center gap-2'>
                      <Upload class='h-10 w-10' stroke-width={2} />
                      <span class='text-lg font-medium'>Drop files to upload</span>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          <FileBrowserModalLayer
            iconEditTarget={iconEditTarget}
            setIconEditTarget={setIconEditTarget}
            customIcons={customIcons}
            onSaveCustomIcon={handleSaveCustomIcon}
            setCustomIconPending={setCustomIconMutation.isPending}
            removeCustomIconPending={removeCustomIconMutation.isPending}
            uploadToast={uploadToast}
            setUploadToastHidden={() => setUploadToast({ kind: 'hidden' })}
            breadcrumbMenu={breadcrumbMenu}
            setBreadcrumbMenu={setBreadcrumbMenu}
            breadcrumbMenuActions={breadcrumbMenuActions}
            onBreadcrumbOpenInNewTab={handleBreadcrumbOpenInNewTab}
            onBreadcrumbOpenInWorkspace={handleBreadcrumbOpenInWorkspace}
            onBreadcrumbSetIcon={handleBreadcrumbSetIcon}
            fileRowMenu={fileRowMenu}
            editableFolders={editableFolders}
            isEditable={isEditable}
            hasEditableFolders={hasEditableFolders}
            onContextDownload={handleContextDownload}
            onContextShare={handleContextShare}
            onCopyShareLink={handleCopyShareLink}
            getPathHasShare={getPathHasShare}
            onContextOpenInNewTab={handleContextOpenInNewTab}
            onContextOpenInWorkspace={handleContextOpenInWorkspace}
            onContextToggleFavorite={handleContextToggleFavorite}
            isRowFavorite={isRowFavorite}
            onContextRename={handleContextRename}
            onContextMove={handleContextMove}
            onContextCopyTo={handleContextCopyTo}
            onContextSetIcon={handleContextSetIcon}
            onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
            isRowKnowledgeBase={isRowKnowledgeBase}
            shareTarget={shareTarget}
            setShareTarget={setShareTarget}
            shareDialogIsEditable={shareDialogIsEditable}
            shareDialogExistingShares={shareDialogExistingShares}
            shareLinkBase={shareLinkBase}
            deleteTarget={deleteTarget}
            setDeleteTarget={setDeleteTarget}
            deletePending={deleteMutation.isPending}
            revokeSharePending={revokeShareMutation.isPending}
            onConfirmDelete={() => {
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
            showCreateFolder={showCreateFolder}
            newItemName={newItemName}
            setNewItemName={setNewItemName}
            submitCreateFolder={submitCreateFolder}
            cancelCreateFolder={() => {
              setShowCreateFolder(false)
              setNewItemName('')
              createFolderMutation.reset()
            }}
            createFolderPending={createFolderMutation.isPending}
            createFolderError={(createFolderMutation.error as Error) ?? null}
            folderExists={folderExists}
            showCreateFile={showCreateFile}
            submitCreateFile={submitCreateFile}
            cancelCreateFile={() => {
              setShowCreateFile(false)
              setNewItemName('')
              createFileMutation.reset()
            }}
            createFilePending={createFileMutation.isPending}
            createFileError={(createFileMutation.error as Error) ?? null}
            fileExists={fileExists}
            inKb={inKb}
            showRename={showRename}
            renameItem={renameItem}
            newNameForRename={newItemName}
            setNewNameForRename={setNewItemName}
            submitRename={submitRename}
            cancelRename={() => {
              setShowRename(false)
              setRenameItem(null)
              setNewItemName('')
              renameMutation.reset()
            }}
            renamePending={renameMutation.isPending}
            renameError={(renameMutation.error as Error) ?? null}
            renameTargetExists={renameTargetExists}
            renameTargetIsDirectory={renameTargetIsDirectory}
            moveDialogTarget={moveDialogTarget}
            copyDialogTarget={copyDialogTarget}
            closeMoveDialog={() => {
              setShowMoveDialog(false)
              setMoveTarget(null)
              moveMutation.reset()
            }}
            closeCopyDialog={() => {
              setShowCopyDialog(false)
              setCopyTarget(null)
              copyMutation.reset()
            }}
            onDialogMove={handleDialogMove}
            onCopyToDestination={handleCopyToDestination}
            movePending={moveMutation.isPending}
            moveError={(moveMutation.error as Error) ?? null}
            copyPending={copyMutation.isPending}
            copyError={(copyMutation.error as Error) ?? null}
            editableFoldersList={editableFolders}
            showPasteDialog={showPasteDialog}
            pasteData={pasteData}
            pastePending={pasteMutation.isPending}
            pasteError={(pasteMutation.error as Error) ?? null}
            pasteExistingLowerNames={pasteExistingLowerNames}
            onPasteFileSubmit={handlePasteFileSubmit}
            closePasteDialog={closePasteDialog}
          />
        </div>
      </div>
    </>
  )
}
