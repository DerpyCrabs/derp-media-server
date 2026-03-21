import { Suspense, useState, useMemo, useEffect, useCallback } from 'react'
import { FileItem, MediaType } from '@/lib/types'
import { isPathEditable, getKnowledgeBaseRoot } from '@/lib/utils'
import { FolderPlus, FilePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { useSettings } from '@/lib/use-settings'
import { useFiles } from '@/lib/use-files'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useViewStats } from '@/lib/use-view-stats'
import { IconEditorDialog } from '@/components/icon-editor-dialog'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { usePaste } from '@/lib/use-paste'
import { PasteDialog } from '@/components/paste-dialog'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { useFileMutations } from '@/lib/use-file-mutations'
import { useAdminEventsStream } from '@/lib/use-admin-events-stream'
import { useFileIcon } from '@/lib/use-file-icon'
import { FileListView } from '@/components/file-list-view'
import { FileGridView } from '@/components/file-grid-view'
import {
  CreateFolderDialog,
  CreateFileDialog,
  RenameDialog,
  DeleteConfirmDialog,
} from '@/components/file-dialogs'
import { ShareDialog } from '@/components/share-dialog'
import { MoveToDialog } from '@/components/move-to-dialog'
import { KbSearchResults } from '@/components/kb-search-results'
import { KbDashboard } from '@/components/kb-dashboard'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { api, post } from '@/lib/api'
import type { ShareLink } from '@/lib/shares'
import { useShareLinkBase } from '@/lib/use-share-link-base'
import { useUpload } from '@/lib/use-upload'
import { UploadDropZone } from '@/components/upload-drop-zone'
import { UploadProgress } from '@/components/upload-progress'
import { UploadMenuButton } from '@/components/upload-menu-button'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useNavigationSession } from '@/lib/use-navigation-session'
import { BrowserPane } from '@/components/browser-pane'
import { BrowserPaneContent } from '@/components/browser-pane-content'
import { ThemeSwitcher } from '@/components/theme-switcher'
import type { NavigationSession } from '@/lib/navigation-session'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_SHARE_LINKS: ShareLink[] = []
const EMPTY_KB_PATHS: string[] = []
const EMPTY_KB_RESULTS: { path: string; name: string; snippet: string }[] = []
const EMPTY_CUSTOM_ICONS: Record<string, string> = {}

const fileListSuspenseFallback = (
  <div className='flex items-center justify-center h-full'>Loading...</div>
)

interface FileListProps {
  files: FileItem[]
  initialViewMode: 'list' | 'grid'
  initialFavorites?: string[]
  initialCustomIcons?: Record<string, string>
  editableFolders: string[]
  session?: NavigationSession
}

function FileListInner({
  initialViewMode,
  initialFavorites = [],
  initialCustomIcons = {},
  editableFolders,
  session: sessionProp,
}: FileListProps) {
  const session = useNavigationSession(sessionProp)
  const { state, navigateToFolder, viewFile, playFile: urlPlayFile } = session
  const currentPath = state.dir || ''
  const shareLinkBase = useShareLinkBase()
  useAdminEventsStream()
  const {
    playFile: startPlayback,
    isPlaying: mediaPlayerIsPlaying,
    mediaType,
    currentFile,
  } = useMediaPlayer()

  const { data: filesData } = useFiles(currentPath)
  // Use view stats hook
  const { incrementView, getViewCount, getShareViewCount } = useViewStats()

  const files = useMemo(() => (Array.isArray(filesData) ? filesData : []), [filesData])

  // Use React Query for real-time settings
  const {
    settings,
    setViewMode: updateViewMode,
    toggleFavorite: updateFavorite,
    toggleKnowledgeBase: updateKnowledgeBase,
    setCustomIcon,
    removeCustomIcon,
    isLoading: settingsLoading,
  } = useSettings(currentPath)

  // Use server settings from React Query, fallback to initial values
  const viewMode = settings.viewMode || initialViewMode
  const favorites = settings.favorites || initialFavorites
  const knowledgeBases = useMemo(
    () => settings.knowledgeBases ?? EMPTY_KB_PATHS,
    [settings.knowledgeBases],
  )
  const customIcons = useMemo(
    () => (settingsLoading ? initialCustomIcons : (settings.customIcons ?? EMPTY_CUSTOM_ICONS)),
    [settingsLoading, initialCustomIcons, settings.customIcons],
  )

  // KB detection: inKb = inside any KB folder (root or subfolder)
  const kbRoot = getKnowledgeBaseRoot(currentPath, knowledgeBases)
  const inKb = kbRoot !== null

  const {
    pasteData,
    showPasteDialog,
    pasteFileMutation,
    handlePaste,
    handlePasteFile,
    closePasteDialog,
  } = usePaste(currentPath)

  // Use file mutations hook
  const {
    createFolderMutation,
    createFileMutation,
    deleteFolderMutation,
    deleteItemMutation,
    renameMutation,
    moveMutation,
    copyMutation,
  } = useFileMutations(currentPath, {
    inKb,
    onNavigateToFolder: navigateToFolder,
    onViewFile: viewFile,
  })

  const {
    uploadFiles,
    isUploading,
    error: uploadError,
    fileCount: uploadFileCount,
    reset: resetUpload,
  } = useUpload()

  const handleUploadFiles = useCallback(
    (uploaded: File[]) => {
      void uploadFiles(uploaded, currentPath)
    },
    [uploadFiles, currentPath],
  )

  const queryClient = useQueryClient()

  // Revoke share mutation (for Shares virtual folder)
  const revokeShareMutation = useMutation({
    mutationFn: (vars: { token: string }) => post('/api/shares/delete', vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files(currentPath) })
    },
  })

  // Fetch shares for indicators
  const { data: sharesData } = useQuery({
    queryKey: queryKeys.shares(),
    queryFn: () => api<{ shares: ShareLink[] }>('/api/shares'),
  })
  const shares = useMemo(() => sharesData?.shares ?? EMPTY_SHARE_LINKS, [sharesData])

  // State for dialogs
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showIconEditor, setShowIconEditor] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [shareTarget, setShareTarget] = useState<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<FileItem | null>(null)
  const [showCopyDialog, setShowCopyDialog] = useState(false)
  const [copyTarget, setCopyTarget] = useState<FileItem | null>(null)
  const [editingItem, setEditingItem] = useState<{ path: string; name: string } | null>(null)
  const [itemToDelete, setItemToDelete] = useState<FileItem | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  useEffect(() => {
    setSearchQuery('')
  }, [currentPath])

  const { data: kbSearchData, isLoading: searchLoading } = useQuery({
    queryKey: queryKeys.kbSearch(kbRoot!, debouncedSearchQuery),
    queryFn: () =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(kbRoot!)}&q=${encodeURIComponent(debouncedSearchQuery)}`,
      ),
    enabled: !!debouncedSearchQuery.trim() && !!kbRoot,
  })
  const searchResults = (kbSearchData?.results ?? EMPTY_KB_RESULTS) as {
    path: string
    name: string
    snippet: string
  }[]

  // Check if we're in a virtual folder
  const isVirtualFolder =
    currentPath === VIRTUAL_FOLDERS.MOST_PLAYED ||
    currentPath === VIRTUAL_FOLDERS.FAVORITES ||
    currentPath === VIRTUAL_FOLDERS.SHARES

  // Check if current directory is editable using client-side utility
  const isEditable = !isVirtualFolder && isPathEditable(currentPath || '', editableFolders)

  const playingPath = state.playing

  // Use file icon hook
  const { getIcon } = useFileIcon({
    customIcons,
    playingPath,
    currentFile,
    mediaPlayerIsPlaying,
    mediaType,
  })

  const handleViewModeChange = useCallback(
    (mode: 'list' | 'grid') => {
      updateViewMode(mode)
    },
    [updateViewMode],
  )

  const handleFavoriteToggle = useCallback(
    async (filePath: string, e: React.MouseEvent) => {
      e.stopPropagation()
      updateFavorite(filePath)
    },
    [updateFavorite],
  )

  const handleFileClick = useCallback(
    (file: FileItem) => {
      if (file.isDirectory) {
        navigateToFolder(file.path)
      } else {
        incrementView(file.path)

        const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO

        if (isMediaFile) {
          const mediaFileType = file.type === MediaType.AUDIO ? 'audio' : 'video'
          startPlayback(file.path, mediaFileType)
          urlPlayFile(file.path, currentPath)
        } else {
          viewFile(file.path, currentPath)
        }
      }
    },
    [navigateToFolder, incrementView, startPlayback, urlPlayFile, currentPath, viewFile],
  )

  const handleKbResultClick = useCallback(
    (filePath: string) => {
      setSearchQuery('')
      viewFile(filePath, currentPath)
    },
    [viewFile, currentPath],
  )

  const handleBreadcrumbClick = useCallback(
    (path: string) => {
      navigateToFolder(path || null)
    },
    [navigateToFolder],
  )

  const handleParentDirectory = useCallback(() => {
    if (isVirtualFolder) {
      navigateToFolder(null)
      return
    }

    const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
    if (pathParts.length > 0) {
      const parentPath = pathParts.slice(0, -1).join('/')
      navigateToFolder(parentPath || null)
    }
  }, [isVirtualFolder, navigateToFolder, currentPath])

  const currentFolderName = currentPath ? currentPath.split(/[/\\]/).pop() : ''

  // Check if new folder name already exists
  const folderExists = useMemo(() => {
    if (!newItemName.trim()) return false
    return files.some((f) => f.isDirectory && f.name.toLowerCase() === newItemName.toLowerCase())
  }, [newItemName, files])

  // Check if new file name already exists (with .md in KB, .txt elsewhere if not provided)
  const fileExists = useMemo(() => {
    if (!newItemName.trim()) return false
    const defaultExt = inKb ? '.md' : '.txt'
    const fileName = newItemName.includes('.') ? newItemName : `${newItemName}${defaultExt}`
    return files.some((f) => !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase())
  }, [newItemName, files, inKb])

  // Check if rename target name already exists (but isn't the original file)
  const renameTargetExists = useMemo(() => {
    if (!newItemName.trim() || !editingItem) return false
    if (renameMutation.isPending) return false
    return files.some(
      (f) => f.path !== editingItem.path && f.name.toLowerCase() === newItemName.toLowerCase(),
    )
  }, [newItemName, files, editingItem, renameMutation.isPending])

  // Update favicon and title based on URL params
  useDynamicFavicon(customIcons, { state })

  const handleSaveIcon = useCallback(
    (iconName: string | null) => {
      if (!editingItem) return
      if (iconName) {
        setCustomIcon(editingItem.path, iconName)
      } else {
        removeCustomIcon(editingItem.path)
      }
    },
    [editingItem, setCustomIcon, removeCustomIcon],
  )

  const handlePasteEvent = useCallback(
    (e: React.ClipboardEvent) => {
      if (!isEditable) return
      const target = e.target as HTMLElement
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return
      }
      void handlePaste(e)
    },
    [isEditable, handlePaste],
  )

  const handleContextSetIcon = useCallback((file: FileItem) => {
    setEditingItem({ path: file.path, name: file.name })
    setShowIconEditor(true)
  }, [])

  const handleContextRename = useCallback((file: FileItem) => {
    setEditingItem({ path: file.path, name: file.name })
    setNewItemName(file.name)
    setShowRenameDialog(true)
  }, [])

  const handleContextDelete = useCallback((file: FileItem) => {
    setItemToDelete(file)
    setShowDeleteConfirm(true)
  }, [])

  const handleContextDownload = useCallback((file: FileItem) => {
    const link = document.createElement('a')
    link.href = `/api/files/download?path=${encodeURIComponent(file.path)}`
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [])

  const handleContextToggleFavorite = useCallback(
    (file: FileItem) => {
      updateFavorite(file.path)
    },
    [updateFavorite],
  )

  const handleContextToggleKnowledgeBase = useCallback(
    (file: FileItem) => {
      updateKnowledgeBase(file.path)
    },
    [updateKnowledgeBase],
  )

  const handleContextShare = useCallback((file: FileItem) => {
    setShareTarget(file)
    setShowShareDialog(true)
  }, [])

  const handleContextCopyShareLink = useCallback(
    async (file: FileItem) => {
      if (!file.shareToken) return
      const url = `${shareLinkBase}/share/${file.shareToken}`
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        /* ignore */
      }
    },
    [shareLinkBase],
  )

  const handleContextOpenInNewTab = useCallback((file: FileItem) => {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const url = `${window.location.origin}${window.location.pathname || '/'}?${params.toString()}`
    window.open(url, '_blank')
  }, [])

  const handleContextOpenInWorkspace = useCallback((file: FileItem) => {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/workspace?${query}` : '/workspace', '_blank')
  }, [])

  const handleMoveFile = useCallback(
    (sourcePath: string, destinationDir: string) => {
      moveMutation.mutate({ sourcePath, destinationDir })
    },
    [moveMutation],
  )

  const handleContextMove = useCallback(
    (file: FileItem) => {
      setMoveTarget(file)
      moveMutation.reset()
      setShowMoveDialog(true)
    },
    [moveMutation],
  )

  const handleContextCopy = useCallback(
    (file: FileItem) => {
      setCopyTarget(file)
      copyMutation.reset()
      setShowCopyDialog(true)
    },
    [copyMutation],
  )

  const handleDialogMove = useCallback(
    (destinationDir: string) => {
      if (!moveTarget) return
      moveMutation.mutate(
        { sourcePath: moveTarget.path, destinationDir },
        {
          onSuccess: () => {
            setShowMoveDialog(false)
            setMoveTarget(null)
            moveMutation.reset()
          },
        },
      )
    },
    [moveTarget, moveMutation],
  )

  const getSharesForPath = useCallback(
    (path: string): ShareLink[] => shares.filter((s) => s.path === path),
    [shares],
  )

  const pasteExistingLowerNames = useMemo(() => files.map((f) => f.name.toLowerCase()), [files])

  const renameTargetIsDirectory = useMemo(
    () =>
      editingItem ? files.find((f) => f.path === editingItem.path)?.isDirectory || false : false,
    [editingItem, files],
  )

  const handleIconEditorClose = useCallback(() => {
    setShowIconEditor(false)
    setEditingItem(null)
  }, [])

  const handleDeleteConfirm = useCallback(() => {
    if (itemToDelete?.shareToken) {
      revokeShareMutation.mutate(
        { token: itemToDelete.shareToken },
        {
          onSuccess: () => {
            setShowDeleteConfirm(false)
            setItemToDelete(null)
            revokeShareMutation.reset()
          },
        },
      )
    } else if (itemToDelete) {
      deleteItemMutation.mutate(itemToDelete.path, {
        onSuccess: () => {
          setShowDeleteConfirm(false)
          setItemToDelete(null)
          deleteItemMutation.reset()
        },
      })
    } else {
      deleteFolderMutation.mutate(undefined, {
        onSuccess: () => {
          setShowDeleteConfirm(false)
          setItemToDelete(null)
          deleteFolderMutation.reset()
        },
      })
    }
  }, [itemToDelete, revokeShareMutation, deleteItemMutation, deleteFolderMutation])

  const handleDeleteReset = useCallback(() => {
    setShowDeleteConfirm(false)
    setItemToDelete(null)
    deleteFolderMutation.reset()
    deleteItemMutation.reset()
    revokeShareMutation.reset()
  }, [deleteFolderMutation, deleteItemMutation, revokeShareMutation])

  const handleCreateFolderSubmit = useCallback(() => {
    createFolderMutation.mutate(newItemName, {
      onSuccess: () => {
        setShowCreateFolder(false)
        setNewItemName('')
        createFolderMutation.reset()
      },
    })
  }, [createFolderMutation, newItemName])

  const handleCreateFolderReset = useCallback(() => {
    setShowCreateFolder(false)
    setNewItemName('')
    createFolderMutation.reset()
  }, [createFolderMutation])

  const handleCreateFileSubmit = useCallback(() => {
    createFileMutation.mutate(newItemName, {
      onSuccess: () => {
        setShowCreateFile(false)
        setNewItemName('')
        createFileMutation.reset()
      },
    })
  }, [createFileMutation, newItemName])

  const handleCreateFileReset = useCallback(() => {
    setShowCreateFile(false)
    setNewItemName('')
    createFileMutation.reset()
  }, [createFileMutation])

  const handleRenameSubmit = useCallback(() => {
    if (editingItem) {
      renameMutation.mutate(
        { oldPath: editingItem.path, newName: newItemName },
        {
          onSuccess: () => {
            setShowRenameDialog(false)
            setEditingItem(null)
            setNewItemName('')
            renameMutation.reset()
          },
        },
      )
    }
  }, [editingItem, newItemName, renameMutation])

  const handleRenameReset = useCallback(() => {
    setShowRenameDialog(false)
    setEditingItem(null)
    setNewItemName('')
    renameMutation.reset()
  }, [renameMutation])

  const handleMoveDialogClose = useCallback(() => {
    setShowMoveDialog(false)
    setMoveTarget(null)
    moveMutation.reset()
  }, [moveMutation])

  const handleCopyDialogClose = useCallback(() => {
    setShowCopyDialog(false)
    setCopyTarget(null)
    copyMutation.reset()
  }, [copyMutation])

  const handleCopyToDestination = useCallback(
    (dest: string) => {
      if (!copyTarget) return
      copyMutation.mutate(
        { sourcePath: copyTarget.path, destinationDir: dest },
        {
          onSuccess: () => {
            setShowCopyDialog(false)
            setCopyTarget(null)
            copyMutation.reset()
          },
        },
      )
    },
    [copyTarget, copyMutation],
  )

  const handleShareDialogClose = useCallback(() => {
    setShowShareDialog(false)
    setShareTarget(null)
  }, [])

  const openToolbarCreateFolder = useCallback(() => {
    setNewItemName('')
    createFolderMutation.reset()
    setShowCreateFolder(true)
  }, [createFolderMutation])

  const openToolbarCreateFile = useCallback(() => {
    setNewItemName('')
    createFileMutation.reset()
    setShowCreateFile(true)
  }, [createFileMutation])

  const handleInlineCreateFile = useCallback(
    (name: string) => {
      createFileMutation.mutate(name, {
        onSuccess: () => createFileMutation.reset(),
      })
    },
    [createFileMutation],
  )

  const handleInlineCreateFolder = useCallback(
    (name: string) => {
      createFolderMutation.mutate(name, {
        onSuccess: () => createFolderMutation.reset(),
      })
    },
    [createFolderMutation],
  )

  const handleInlineCreateCancel = useCallback(() => {
    createFileMutation.reset()
    createFolderMutation.reset()
  }, [createFileMutation, createFolderMutation])

  const hasEditableFolders = editableFolders.length > 0

  const contextCopyHandler = useMemo(
    () => (hasEditableFolders ? handleContextCopy : undefined),
    [hasEditableFolders, handleContextCopy],
  )

  const shareDialogExistingShares = useMemo(
    () => (shareTarget ? getSharesForPath(shareTarget.path) : EMPTY_SHARE_LINKS),
    [shareTarget, getSharesForPath],
  )

  const dialogs = useMemo(
    () => (
      <>
        <IconEditorDialog
          key={`${showIconEditor}`}
          isOpen={showIconEditor}
          onClose={handleIconEditorClose}
          fileName={editingItem?.name || ''}
          currentIcon={editingItem ? customIcons[editingItem.path] || null : null}
          onSave={handleSaveIcon}
        />

        <DeleteConfirmDialog
          isOpen={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          item={itemToDelete}
          currentFolderName={currentFolderName}
          onDelete={handleDeleteConfirm}
          isPending={
            deleteFolderMutation.isPending ||
            deleteItemMutation.isPending ||
            revokeShareMutation.isPending
          }
          error={
            deleteFolderMutation.error || deleteItemMutation.error || revokeShareMutation.error
          }
          onReset={handleDeleteReset}
          isRevokeShare={!!itemToDelete?.shareToken}
        />

        <CreateFolderDialog
          isOpen={showCreateFolder}
          onOpenChange={setShowCreateFolder}
          folderName={newItemName}
          onFolderNameChange={setNewItemName}
          onCreateFolder={handleCreateFolderSubmit}
          isPending={createFolderMutation.isPending}
          error={createFolderMutation.error}
          folderExists={folderExists}
          onReset={handleCreateFolderReset}
        />

        <CreateFileDialog
          isOpen={showCreateFile}
          onOpenChange={setShowCreateFile}
          fileName={newItemName}
          onFileNameChange={setNewItemName}
          defaultExtension={inKb ? 'md' : 'txt'}
          onCreateFile={handleCreateFileSubmit}
          isPending={createFileMutation.isPending}
          error={createFileMutation.error}
          fileExists={fileExists}
          onReset={handleCreateFileReset}
        />

        <RenameDialog
          isOpen={showRenameDialog}
          onOpenChange={setShowRenameDialog}
          itemName={editingItem?.name || ''}
          newName={newItemName}
          onNewNameChange={setNewItemName}
          onRename={handleRenameSubmit}
          isPending={renameMutation.isPending}
          error={renameMutation.error}
          nameExists={renameTargetExists}
          isDirectory={renameTargetIsDirectory}
          onReset={handleRenameReset}
        />

        <PasteDialog
          isOpen={showPasteDialog}
          pasteData={pasteData}
          isPending={pasteFileMutation.isPending}
          error={pasteFileMutation.error}
          existingFiles={pasteExistingLowerNames}
          onPaste={handlePasteFile}
          onClose={closePasteDialog}
        />

        <MoveToDialog
          isOpen={showMoveDialog}
          onClose={handleMoveDialogClose}
          fileName={moveTarget?.name || ''}
          filePath={moveTarget?.path || ''}
          onMove={handleDialogMove}
          isPending={moveMutation.isPending}
          error={moveMutation.error}
          editableFolders={editableFolders}
        />

        <MoveToDialog
          mode='copy'
          isOpen={showCopyDialog}
          onClose={handleCopyDialogClose}
          fileName={copyTarget?.name || ''}
          filePath={copyTarget?.path || ''}
          onMove={handleCopyToDestination}
          isPending={copyMutation.isPending}
          error={copyMutation.error}
          editableFolders={editableFolders}
        />

        <ShareDialog
          isOpen={showShareDialog}
          onClose={handleShareDialogClose}
          filePath={shareTarget?.path || ''}
          fileName={shareTarget?.name || ''}
          isDirectory={shareTarget?.isDirectory || false}
          isEditable={shareTarget ? isPathEditable(shareTarget.path, editableFolders) : false}
          existingShares={shareDialogExistingShares}
        />
      </>
    ),
    [
      showIconEditor,
      handleIconEditorClose,
      editingItem,
      customIcons,
      handleSaveIcon,
      showDeleteConfirm,
      itemToDelete,
      currentFolderName,
      handleDeleteConfirm,
      deleteFolderMutation.isPending,
      deleteItemMutation.isPending,
      revokeShareMutation.isPending,
      deleteFolderMutation.error,
      deleteItemMutation.error,
      revokeShareMutation.error,
      handleDeleteReset,
      showCreateFolder,
      newItemName,
      handleCreateFolderSubmit,
      createFolderMutation.isPending,
      createFolderMutation.error,
      folderExists,
      handleCreateFolderReset,
      showCreateFile,
      inKb,
      handleCreateFileSubmit,
      createFileMutation.isPending,
      createFileMutation.error,
      fileExists,
      handleCreateFileReset,
      showRenameDialog,
      handleRenameSubmit,
      renameMutation.isPending,
      renameMutation.error,
      renameTargetExists,
      renameTargetIsDirectory,
      handleRenameReset,
      showPasteDialog,
      pasteData,
      pasteFileMutation.isPending,
      pasteFileMutation.error,
      pasteExistingLowerNames,
      handlePasteFile,
      closePasteDialog,
      showMoveDialog,
      handleMoveDialogClose,
      moveTarget,
      handleDialogMove,
      moveMutation.isPending,
      moveMutation.error,
      editableFolders,
      showCopyDialog,
      handleCopyDialogClose,
      copyTarget,
      handleCopyToDestination,
      copyMutation.isPending,
      copyMutation.error,
      showShareDialog,
      handleShareDialogClose,
      shareTarget,
      shareDialogExistingShares,
    ],
  )

  const toolbarActions = useMemo(
    () =>
      isEditable ? (
        <>
          <Button
            variant='outline'
            size='icon'
            onClick={openToolbarCreateFolder}
            title='Create new folder'
            className='h-8 w-8'
          >
            <FolderPlus className='h-4 w-4' />
          </Button>
          <Button
            variant='outline'
            size='icon'
            onClick={openToolbarCreateFile}
            title='Create new file'
            className='h-8 w-8'
          >
            <FilePlus className='h-4 w-4' />
          </Button>
          <UploadMenuButton disabled={isUploading} onUpload={handleUploadFiles} />
          <div className='w-px h-6 bg-border mx-1' />
        </>
      ) : null,
    [isEditable, openToolbarCreateFolder, openToolbarCreateFile, isUploading, handleUploadFiles],
  )

  const listView = useMemo(
    () => (
      <FileListView
        files={files}
        currentPath={currentPath}
        favorites={favorites}
        playingPath={playingPath}
        isVirtualFolder={isVirtualFolder}
        editableFolders={editableFolders}
        onFileClick={handleFileClick}
        onParentDirectory={handleParentDirectory}
        onFavoriteToggle={handleFavoriteToggle}
        onContextSetIcon={handleContextSetIcon}
        onContextRename={handleContextRename}
        onContextDelete={handleContextDelete}
        onContextDownload={handleContextDownload}
        onContextToggleFavorite={handleContextToggleFavorite}
        onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
        onContextShare={handleContextShare}
        onContextCopyShareLink={handleContextCopyShareLink}
        onContextMove={handleContextMove}
        onContextCopy={contextCopyHandler}
        onContextOpenInNewTab={handleContextOpenInNewTab}
        onContextOpenInWorkspace={handleContextOpenInWorkspace}
        hasEditableFolders={hasEditableFolders}
        onMoveFile={handleMoveFile}
        shares={shares}
        knowledgeBases={knowledgeBases}
        getViewCount={getViewCount}
        getShareViewCount={getShareViewCount}
        getIcon={getIcon}
        showInlineCreate={isEditable && inKb}
        onInlineCreateFile={handleInlineCreateFile}
        onInlineCreateFolder={handleInlineCreateFolder}
        onInlineCreateCancel={handleInlineCreateCancel}
        createFilePending={createFileMutation.isPending}
        createFolderPending={createFolderMutation.isPending}
        createFileError={createFileMutation.error}
        createFolderError={createFolderMutation.error}
      />
    ),
    [
      files,
      currentPath,
      favorites,
      playingPath,
      isVirtualFolder,
      editableFolders,
      handleFileClick,
      handleParentDirectory,
      handleFavoriteToggle,
      handleContextSetIcon,
      handleContextRename,
      handleContextDelete,
      handleContextDownload,
      handleContextToggleFavorite,
      handleContextToggleKnowledgeBase,
      handleContextShare,
      handleContextCopyShareLink,
      handleContextMove,
      contextCopyHandler,
      handleContextOpenInNewTab,
      handleContextOpenInWorkspace,
      hasEditableFolders,
      handleMoveFile,
      shares,
      knowledgeBases,
      getViewCount,
      getShareViewCount,
      getIcon,
      isEditable,
      inKb,
      handleInlineCreateFile,
      handleInlineCreateFolder,
      handleInlineCreateCancel,
      createFileMutation.isPending,
      createFolderMutation.isPending,
      createFileMutation.error,
      createFolderMutation.error,
    ],
  )

  const gridView = useMemo(
    () => (
      <FileGridView
        files={files}
        currentPath={currentPath}
        favorites={favorites}
        playingPath={playingPath}
        isVirtualFolder={isVirtualFolder}
        editableFolders={editableFolders}
        onFileClick={handleFileClick}
        onParentDirectory={handleParentDirectory}
        onFavoriteToggle={handleFavoriteToggle}
        onContextSetIcon={handleContextSetIcon}
        onContextRename={handleContextRename}
        onContextDelete={handleContextDelete}
        onContextDownload={handleContextDownload}
        onContextToggleFavorite={handleContextToggleFavorite}
        onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
        onContextShare={handleContextShare}
        onContextCopyShareLink={handleContextCopyShareLink}
        onContextMove={handleContextMove}
        onContextCopy={contextCopyHandler}
        onContextOpenInNewTab={handleContextOpenInNewTab}
        onContextOpenInWorkspace={handleContextOpenInWorkspace}
        hasEditableFolders={hasEditableFolders}
        onMoveFile={handleMoveFile}
        shares={shares}
        knowledgeBases={knowledgeBases}
        getViewCount={getViewCount}
        getShareViewCount={getShareViewCount}
        getIcon={getIcon}
      />
    ),
    [
      files,
      currentPath,
      favorites,
      playingPath,
      isVirtualFolder,
      editableFolders,
      handleFileClick,
      handleParentDirectory,
      handleFavoriteToggle,
      handleContextSetIcon,
      handleContextRename,
      handleContextDelete,
      handleContextDownload,
      handleContextToggleFavorite,
      handleContextToggleKnowledgeBase,
      handleContextShare,
      handleContextCopyShareLink,
      handleContextMove,
      contextCopyHandler,
      handleContextOpenInNewTab,
      handleContextOpenInWorkspace,
      hasEditableFolders,
      handleMoveFile,
      shares,
      knowledgeBases,
      getViewCount,
      getShareViewCount,
      getIcon,
    ],
  )

  const uploadProgressSlot = useMemo(
    () => (
      <UploadProgress
        isUploading={isUploading}
        error={uploadError}
        fileCount={uploadFileCount}
        onDismiss={resetUpload}
      />
    ),
    [isUploading, uploadError, uploadFileCount, resetUpload],
  )

  const breadcrumbsSlot = useMemo(
    () => (
      <Breadcrumbs
        currentPath={currentPath}
        onNavigate={handleBreadcrumbClick}
        customIcons={customIcons}
        onContextSetIcon={handleContextSetIcon}
        onContextRename={handleContextRename}
        onContextDelete={handleContextDelete}
        onContextDownload={handleContextDownload}
        onContextToggleFavorite={handleContextToggleFavorite}
        onContextShare={handleContextShare}
        onContextOpenInNewTab={handleContextOpenInNewTab}
        onContextOpenInWorkspace={handleContextOpenInWorkspace}
        favorites={favorites}
        editableFolders={editableFolders}
        shares={shares}
      />
    ),
    [
      currentPath,
      handleBreadcrumbClick,
      customIcons,
      handleContextSetIcon,
      handleContextRename,
      handleContextDelete,
      handleContextDownload,
      handleContextToggleFavorite,
      handleContextShare,
      handleContextOpenInNewTab,
      handleContextOpenInWorkspace,
      favorites,
      editableFolders,
      shares,
    ],
  )

  const searchConfig = useMemo(
    () => ({
      visible: inKb,
      placeholder: 'Search notes...',
      value: searchQuery,
      onChange: setSearchQuery,
    }),
    [inKb, searchQuery],
  )

  const themeSwitcherSlot = useMemo(() => <ThemeSwitcher variant='header' />, [])

  const kbSearchResultsSlot = useMemo(
    () => (
      <KbSearchResults
        results={searchResults}
        query={searchQuery}
        isLoading={searchLoading}
        currentPath={currentPath}
        onResultClick={handleKbResultClick}
      />
    ),
    [searchResults, searchQuery, searchLoading, currentPath, handleKbResultClick],
  )

  const kbDashboardSlot = useMemo(
    () =>
      inKb && currentPath ? (
        <KbDashboard scopePath={currentPath} onFileClick={handleKbResultClick} />
      ) : null,
    [inKb, currentPath, handleKbResultClick],
  )

  return (
    <div
      className='flex flex-col'
      data-testid='file-browser'
      onPaste={handlePasteEvent}
      tabIndex={-1}
    >
      <BrowserPane
        dialogs={dialogs}
        progress={uploadProgressSlot}
        breadcrumbs={breadcrumbsSlot}
        search={searchConfig}
        actions={toolbarActions}
        trailingSlot={themeSwitcherSlot}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      >
        <UploadDropZone
          enabled={isEditable}
          onUpload={handleUploadFiles}
          className='flex flex-col min-h-0 flex-1 overflow-hidden'
        >
          <BrowserPaneContent
            searchQuery={searchQuery}
            searchResults={kbSearchResultsSlot}
            dashboard={kbDashboardSlot}
            viewMode={viewMode}
            listView={listView}
            gridView={gridView}
          />
        </UploadDropZone>
      </BrowserPane>
    </div>
  )
}

export function FileList(props: FileListProps) {
  return (
    <Suspense fallback={fileListSuspenseFallback}>
      <FileListInner {...props} />
    </Suspense>
  )
}
