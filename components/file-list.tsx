import { Suspense, useState, useMemo, useEffect } from 'react'
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
import type { NavigationSession } from '@/lib/navigation-session'
import { queryKeys } from '@/lib/query-keys'

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
  const knowledgeBases = settings.knowledgeBases || []
  // Use initialCustomIcons until settings load, then switch to React Query data
  const customIcons = settingsLoading ? initialCustomIcons : settings.customIcons || {}

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

  const handleUploadFiles = (files: File[]) => {
    uploadFiles(files, currentPath)
  }

  const queryClient = useQueryClient()

  // Revoke share mutation (for Shares virtual folder)
  const revokeShareMutation = useMutation({
    mutationFn: (vars: { token: string }) => post('/api/shares/delete', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      queryClient.invalidateQueries({ queryKey: queryKeys.files(currentPath) })
    },
  })

  // Fetch shares for indicators
  const { data: sharesData } = useQuery({
    queryKey: queryKeys.shares(),
    queryFn: () => api<{ shares: ShareLink[] }>('/api/shares'),
  })
  const shares = sharesData?.shares || []

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
  const searchResults = (kbSearchData?.results || []) as {
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

  // Handle view mode change
  const handleViewModeChange = (mode: 'list' | 'grid') => {
    updateViewMode(mode)
  }

  // Handle favorite toggle
  const handleFavoriteToggle = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent file click
    updateFavorite(filePath)
  }

  const handleFileClick = (file: FileItem) => {
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
  }

  const handleKbResultClick = (filePath: string) => {
    setSearchQuery('')
    viewFile(filePath, currentPath)
  }

  const handleBreadcrumbClick = (path: string) => {
    navigateToFolder(path || null)
  }

  const handleParentDirectory = () => {
    if (isVirtualFolder) {
      navigateToFolder(null)
      return
    }

    const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
    if (pathParts.length > 0) {
      const parentPath = pathParts.slice(0, -1).join('/')
      navigateToFolder(parentPath || null)
    }
  }

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

  const handleSaveIcon = (iconName: string | null) => {
    if (!editingItem) return
    if (iconName) {
      setCustomIcon(editingItem.path, iconName)
    } else {
      removeCustomIcon(editingItem.path)
    }
  }

  const handlePasteEvent = (e: React.ClipboardEvent) => {
    if (!isEditable) return
    const target = e.target as HTMLElement
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return
    }
    handlePaste(e)
  }

  // Handle context menu action for setting icon
  const handleContextSetIcon = (file: FileItem) => {
    setEditingItem({ path: file.path, name: file.name })
    setShowIconEditor(true)
  }

  // Handle context menu action for renaming
  const handleContextRename = (file: FileItem) => {
    setEditingItem({ path: file.path, name: file.name })
    setNewItemName(file.name)
    setShowRenameDialog(true)
  }

  // Handle context menu action for deleting
  const handleContextDelete = (file: FileItem) => {
    setItemToDelete(file)
    setShowDeleteConfirm(true)
  }

  // Handle context menu action for downloading
  const handleContextDownload = (file: FileItem) => {
    const link = document.createElement('a')
    link.href = `/api/files/download?path=${encodeURIComponent(file.path)}`
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Handle context menu action for toggling favorite
  const handleContextToggleFavorite = (file: FileItem) => {
    updateFavorite(file.path)
  }

  // Handle context menu action for toggling knowledge base
  const handleContextToggleKnowledgeBase = (file: FileItem) => {
    updateKnowledgeBase(file.path)
  }

  // Handle context menu action for sharing
  const handleContextShare = (file: FileItem) => {
    setShareTarget(file)
    setShowShareDialog(true)
  }

  // Handle context menu action for copying share link (in Shares folder)
  const handleContextCopyShareLink = async (file: FileItem) => {
    if (!file.shareToken) return
    const url = `${shareLinkBase}/share/${file.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
  }

  const handleContextOpenInNewTab = (file: FileItem) => {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const url = `${window.location.origin}${window.location.pathname || '/'}?${params.toString()}`
    window.open(url, '_blank')
  }

  const handleContextOpenInWorkspace = (file: FileItem) => {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/workspace?${query}` : '/workspace', '_blank')
  }

  const handleMoveFile = (sourcePath: string, destinationDir: string) => {
    moveMutation.mutate({ sourcePath, destinationDir })
  }

  const handleContextMove = (file: FileItem) => {
    setMoveTarget(file)
    moveMutation.reset()
    setShowMoveDialog(true)
  }

  const handleContextCopy = (file: FileItem) => {
    setCopyTarget(file)
    copyMutation.reset()
    setShowCopyDialog(true)
  }

  const handleDialogMove = (destinationDir: string) => {
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
  }

  const getSharesForPath = (path: string): ShareLink[] => {
    return shares.filter((s) => s.path === path)
  }

  const dialogs = (
    <>
      <IconEditorDialog
        key={`${showIconEditor}`}
        isOpen={showIconEditor}
        onClose={() => {
          setShowIconEditor(false)
          setEditingItem(null)
        }}
        fileName={editingItem?.name || ''}
        currentIcon={editingItem ? customIcons[editingItem.path] || null : null}
        onSave={handleSaveIcon}
      />

      <DeleteConfirmDialog
        isOpen={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        item={itemToDelete}
        currentFolderName={currentFolderName}
        onDelete={() => {
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
        }}
        isPending={
          deleteFolderMutation.isPending ||
          deleteItemMutation.isPending ||
          revokeShareMutation.isPending
        }
        error={deleteFolderMutation.error || deleteItemMutation.error || revokeShareMutation.error}
        onReset={() => {
          setShowDeleteConfirm(false)
          setItemToDelete(null)
          deleteFolderMutation.reset()
          deleteItemMutation.reset()
          revokeShareMutation.reset()
        }}
        isRevokeShare={!!itemToDelete?.shareToken}
      />

      <CreateFolderDialog
        isOpen={showCreateFolder}
        onOpenChange={setShowCreateFolder}
        folderName={newItemName}
        onFolderNameChange={setNewItemName}
        onCreateFolder={() =>
          createFolderMutation.mutate(newItemName, {
            onSuccess: () => {
              setShowCreateFolder(false)
              setNewItemName('')
              createFolderMutation.reset()
            },
          })
        }
        isPending={createFolderMutation.isPending}
        error={createFolderMutation.error}
        folderExists={folderExists}
        onReset={() => {
          setShowCreateFolder(false)
          setNewItemName('')
          createFolderMutation.reset()
        }}
      />

      <CreateFileDialog
        isOpen={showCreateFile}
        onOpenChange={setShowCreateFile}
        fileName={newItemName}
        onFileNameChange={setNewItemName}
        defaultExtension={inKb ? 'md' : 'txt'}
        onCreateFile={() =>
          createFileMutation.mutate(newItemName, {
            onSuccess: () => {
              setShowCreateFile(false)
              setNewItemName('')
              createFileMutation.reset()
            },
          })
        }
        isPending={createFileMutation.isPending}
        error={createFileMutation.error}
        fileExists={fileExists}
        onReset={() => {
          setShowCreateFile(false)
          setNewItemName('')
          createFileMutation.reset()
        }}
      />

      <RenameDialog
        isOpen={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        itemName={editingItem?.name || ''}
        newName={newItemName}
        onNewNameChange={setNewItemName}
        onRename={() => {
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
        }}
        isPending={renameMutation.isPending}
        error={renameMutation.error}
        nameExists={renameTargetExists}
        isDirectory={
          editingItem ? files.find((f) => f.path === editingItem.path)?.isDirectory || false : false
        }
        onReset={() => {
          setShowRenameDialog(false)
          setEditingItem(null)
          setNewItemName('')
          renameMutation.reset()
        }}
      />

      <PasteDialog
        isOpen={showPasteDialog}
        pasteData={pasteData}
        isPending={pasteFileMutation.isPending}
        error={pasteFileMutation.error}
        existingFiles={files.map((f) => f.name.toLowerCase())}
        onPaste={handlePasteFile}
        onClose={closePasteDialog}
      />

      <MoveToDialog
        isOpen={showMoveDialog}
        onClose={() => {
          setShowMoveDialog(false)
          setMoveTarget(null)
          moveMutation.reset()
        }}
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
        onClose={() => {
          setShowCopyDialog(false)
          setCopyTarget(null)
          copyMutation.reset()
        }}
        fileName={copyTarget?.name || ''}
        filePath={copyTarget?.path || ''}
        onMove={(dest) => {
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
        }}
        isPending={copyMutation.isPending}
        error={copyMutation.error}
        editableFolders={editableFolders}
      />

      <ShareDialog
        isOpen={showShareDialog}
        onClose={() => {
          setShowShareDialog(false)
          setShareTarget(null)
        }}
        filePath={shareTarget?.path || ''}
        fileName={shareTarget?.name || ''}
        isDirectory={shareTarget?.isDirectory || false}
        isEditable={shareTarget ? isPathEditable(shareTarget.path, editableFolders) : false}
        existingShares={shareTarget ? getSharesForPath(shareTarget.path) : []}
      />
    </>
  )

  const toolbarActions = isEditable ? (
    <>
      <Button
        variant='outline'
        size='icon'
        onClick={() => {
          setNewItemName('')
          createFolderMutation.reset()
          setShowCreateFolder(true)
        }}
        title='Create new folder'
        className='h-8 w-8'
      >
        <FolderPlus className='h-4 w-4' />
      </Button>
      <Button
        variant='outline'
        size='icon'
        onClick={() => {
          setNewItemName('')
          createFileMutation.reset()
          setShowCreateFile(true)
        }}
        title='Create new file'
        className='h-8 w-8'
      >
        <FilePlus className='h-4 w-4' />
      </Button>
      <UploadMenuButton disabled={isUploading} onUpload={handleUploadFiles} />
      <div className='w-px h-6 bg-border mx-1' />
    </>
  ) : null

  const listView = (
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
      onContextCopy={editableFolders.length > 0 ? handleContextCopy : undefined}
      onContextOpenInNewTab={handleContextOpenInNewTab}
      onContextOpenInWorkspace={handleContextOpenInWorkspace}
      hasEditableFolders={editableFolders.length > 0}
      onMoveFile={handleMoveFile}
      shares={shares}
      knowledgeBases={knowledgeBases}
      getViewCount={getViewCount}
      getShareViewCount={getShareViewCount}
      getIcon={getIcon}
      showInlineCreate={isEditable && inKb}
      onInlineCreateFile={(name) =>
        createFileMutation.mutate(name, {
          onSuccess: () => createFileMutation.reset(),
        })
      }
      onInlineCreateFolder={(name) =>
        createFolderMutation.mutate(name, {
          onSuccess: () => createFolderMutation.reset(),
        })
      }
      onInlineCreateCancel={() => {
        createFileMutation.reset()
        createFolderMutation.reset()
      }}
      createFilePending={createFileMutation.isPending}
      createFolderPending={createFolderMutation.isPending}
      createFileError={createFileMutation.error}
      createFolderError={createFolderMutation.error}
    />
  )

  const gridView = (
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
      onContextCopy={editableFolders.length > 0 ? handleContextCopy : undefined}
      onContextOpenInNewTab={handleContextOpenInNewTab}
      onContextOpenInWorkspace={handleContextOpenInWorkspace}
      hasEditableFolders={editableFolders.length > 0}
      onMoveFile={handleMoveFile}
      shares={shares}
      knowledgeBases={knowledgeBases}
      getViewCount={getViewCount}
      getShareViewCount={getShareViewCount}
      getIcon={getIcon}
    />
  )

  return (
    <div className='flex flex-col' onPaste={handlePasteEvent} tabIndex={-1}>
      <BrowserPane
        dialogs={dialogs}
        progress={
          <UploadProgress
            isUploading={isUploading}
            error={uploadError}
            fileCount={uploadFileCount}
            onDismiss={resetUpload}
          />
        }
        breadcrumbs={
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
        }
        search={{
          visible: inKb,
          placeholder: 'Search notes...',
          value: searchQuery,
          onChange: setSearchQuery,
        }}
        actions={toolbarActions}
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
            searchResults={
              <KbSearchResults
                results={searchResults}
                query={searchQuery}
                isLoading={searchLoading}
                currentPath={currentPath}
                onResultClick={handleKbResultClick}
              />
            }
            dashboard={
              inKb && currentPath ? (
                <KbDashboard scopePath={currentPath} onFileClick={handleKbResultClick} />
              ) : null
            }
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
    <Suspense fallback={<div className='flex items-center justify-center h-full'>Loading...</div>}>
      <FileListInner {...props} />
    </Suspense>
  )
}
