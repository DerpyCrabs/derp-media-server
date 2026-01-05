'use client'

import { Suspense, useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileItem, MediaType } from '@/lib/types'
import { isPathEditable } from '@/lib/utils'
import { FolderPlus, FilePlus, List, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { useSettings } from '@/lib/use-settings'
import { useFiles, usePrefetchFiles } from '@/lib/use-files'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useViewStats } from '@/lib/use-view-stats'
import { IconEditorDialog } from '@/components/icon-editor-dialog'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { usePaste } from '@/lib/use-paste'
import { PasteDialog } from '@/components/paste-dialog'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { useFileMutations } from '@/lib/use-file-mutations'
import { useFileIcon } from '@/lib/use-file-icon'
import { FileListView } from '@/components/file-list-view'
import { FileGridView } from '@/components/file-grid-view'
import {
  CreateFolderDialog,
  CreateFileDialog,
  RenameDialog,
  DeleteConfirmDialog,
} from '@/components/file-dialogs'

interface FileListProps {
  files: FileItem[]
  currentPath: string
  initialViewMode: 'list' | 'grid'
  initialFavorites?: string[]
  initialCustomIcons?: Record<string, string>
  editableFolders: string[]
}

function FileListInner({
  files: initialFiles,
  currentPath,
  initialViewMode,
  initialFavorites = [],
  initialCustomIcons = {},
  editableFolders,
}: FileListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { playFile, isPlaying: mediaPlayerIsPlaying, mediaType, currentFile } = useMediaPlayer()

  // Use React Query for files with SSR initial data
  const { data: filesData } = useFiles(currentPath, initialFiles)
  const prefetchFiles = usePrefetchFiles()

  // Use view stats hook
  const { incrementView, getViewCount } = useViewStats()

  // Ensure files is ALWAYS an array, no matter what
  const files = useMemo(
    () => (Array.isArray(filesData) ? filesData : Array.isArray(initialFiles) ? initialFiles : []),
    [filesData, initialFiles],
  )

  // Use React Query for real-time settings
  const {
    settings,
    setViewMode: updateViewMode,
    toggleFavorite: updateFavorite,
    setCustomIcon,
    removeCustomIcon,
    isLoading: settingsLoading,
  } = useSettings(currentPath)

  // Use server settings from React Query, fallback to initial values
  const viewMode = settings.viewMode || initialViewMode
  const favorites = settings.favorites || initialFavorites
  // Use initialCustomIcons until settings load, then switch to React Query data
  const customIcons = settingsLoading ? initialCustomIcons : settings.customIcons || {}

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
  } = useFileMutations(currentPath)

  // State for dialogs
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showIconEditor, setShowIconEditor] = useState(false)
  const [editingItem, setEditingItem] = useState<{ path: string; name: string } | null>(null)
  const [itemToDelete, setItemToDelete] = useState<FileItem | null>(null)
  const [newItemName, setNewItemName] = useState('')

  // Check if we're in a virtual folder
  const isVirtualFolder =
    currentPath === VIRTUAL_FOLDERS.MOST_PLAYED || currentPath === VIRTUAL_FOLDERS.FAVORITES

  // Check if current directory is editable using client-side utility
  const isEditable = !isVirtualFolder && isPathEditable(currentPath || '', editableFolders)

  const playingPath = searchParams.get('playing')

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

  // Prefetch folder contents on hover
  const handleFolderHover = (folderPath: string) => {
    prefetchFiles(folderPath)
  }

  const handleFileClick = (file: FileItem) => {
    const params = new URLSearchParams(searchParams)

    if (file.isDirectory) {
      // Navigate to folder
      params.set('dir', file.path)
      // Keep the playing state when changing folders
      router.push(`/?${params.toString()}`, { scroll: false })
    } else {
      // Increment view count for files (not directories)
      incrementView(file.path)

      // For audio/video, use 'playing' parameter and trigger store playback
      // For images/text/other files, use 'viewing' parameter (this keeps audio/video playing)
      const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO

      if (isMediaFile) {
        const mediaFileType = file.type === MediaType.AUDIO ? 'audio' : 'video'
        playFile(file.path, mediaFileType)

        params.delete('viewing')
        params.set('playing', file.path)
        params.set('dir', currentPath)
        router.replace(`/?${params.toString()}`, { scroll: false })
      } else {
        params.set('viewing', file.path)
        params.set('dir', currentPath)
        router.replace(`/?${params.toString()}`, { scroll: false })
      }
    }
  }

  const handleBreadcrumbClick = (path: string) => {
    const params = new URLSearchParams(searchParams)
    if (path) {
      params.set('dir', path)
    } else {
      params.delete('dir')
    }
    // Keep the playing state when navigating via breadcrumbs
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  // Handle navigation to parent directory
  const handleParentDirectory = () => {
    const params = new URLSearchParams(searchParams)

    // If we're in a virtual folder, go back to root
    if (isVirtualFolder) {
      params.delete('dir')
      router.push(`/?${params.toString()}`, { scroll: false })
      return
    }

    const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
    if (pathParts.length > 0) {
      const parentPath = pathParts.slice(0, -1).join('/')
      if (parentPath) {
        params.set('dir', parentPath)
      } else {
        params.delete('dir')
      }
      router.push(`/?${params.toString()}`, { scroll: false })
    }
  }

  const currentFolderName = currentPath ? currentPath.split(/[/\\]/).pop() : ''

  // Check if new folder name already exists
  const folderExists = useMemo(() => {
    if (!newItemName.trim()) return false
    return files.some((f) => f.isDirectory && f.name.toLowerCase() === newItemName.toLowerCase())
  }, [newItemName, files])

  // Check if new file name already exists (with .txt extension if not provided)
  const fileExists = useMemo(() => {
    if (!newItemName.trim()) return false
    const fileName = newItemName.includes('.') ? newItemName : `${newItemName}.txt`
    return files.some((f) => !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase())
  }, [newItemName, files])

  // Check if rename target name already exists (but isn't the original file)
  const renameTargetExists = useMemo(() => {
    if (!newItemName.trim() || !editingItem) return false
    return files.some(
      (f) => f.path !== editingItem.path && f.name.toLowerCase() === newItemName.toLowerCase(),
    )
  }, [newItemName, files, editingItem])

  // Update favicon and title based on URL params
  useDynamicFavicon(customIcons)

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

  return (
    <div className='flex flex-col' onPaste={handlePasteEvent} tabIndex={-1}>
      {/* Icon Editor Dialog */}
      <IconEditorDialog
        isOpen={showIconEditor}
        onClose={() => {
          setShowIconEditor(false)
          setEditingItem(null)
        }}
        fileName={editingItem?.name || ''}
        currentIcon={editingItem ? customIcons[editingItem.path] || null : null}
        onSave={handleSaveIcon}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        item={itemToDelete}
        currentFolderName={currentFolderName}
        onDelete={() => {
          if (itemToDelete) {
            deleteItemMutation.mutate(itemToDelete.path)
          } else {
            deleteFolderMutation.mutate()
          }
        }}
        isPending={deleteFolderMutation.isPending || deleteItemMutation.isPending}
        error={deleteFolderMutation.error || deleteItemMutation.error}
        onReset={() => {
          setShowDeleteConfirm(false)
          setItemToDelete(null)
          deleteFolderMutation.reset()
          deleteItemMutation.reset()
        }}
      />

      {/* Create Folder Dialog */}
      <CreateFolderDialog
        isOpen={showCreateFolder}
        onOpenChange={setShowCreateFolder}
        folderName={newItemName}
        onFolderNameChange={setNewItemName}
        onCreateFolder={() => createFolderMutation.mutate(newItemName)}
        isPending={createFolderMutation.isPending}
        error={createFolderMutation.error}
        folderExists={folderExists}
        onReset={() => {
          setShowCreateFolder(false)
          setNewItemName('')
          createFolderMutation.reset()
        }}
      />

      {/* Create File Dialog */}
      <CreateFileDialog
        isOpen={showCreateFile}
        onOpenChange={setShowCreateFile}
        fileName={newItemName}
        onFileNameChange={setNewItemName}
        onCreateFile={() => createFileMutation.mutate(newItemName)}
        isPending={createFileMutation.isPending}
        error={createFileMutation.error}
        fileExists={fileExists}
        onReset={() => {
          setShowCreateFile(false)
          setNewItemName('')
          createFileMutation.reset()
        }}
      />

      {/* Rename Dialog */}
      <RenameDialog
        isOpen={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        itemName={editingItem?.name || ''}
        newName={newItemName}
        onNewNameChange={setNewItemName}
        onRename={() => {
          if (editingItem) {
            renameMutation.mutate({ oldPath: editingItem.path, newName: newItemName })
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

      {/* Breadcrumb Navigation with Toolbar */}
      <div className='p-1.5 lg:p-2 border-b border-border bg-muted/30 shrink-0'>
        <div className='flex items-center justify-between gap-1.5 lg:gap-2'>
          <Breadcrumbs
            currentPath={currentPath}
            onNavigate={handleBreadcrumbClick}
            onFolderHover={handleFolderHover}
            customIcons={customIcons}
          />
          <div className='flex gap-1 items-center'>
            {isEditable && (
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
                <div className='w-px h-6 bg-border mx-1' />
              </>
            )}
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleViewModeChange('list')}
              className='h-8 w-8 p-0'
            >
              <List className='h-4 w-4' />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleViewModeChange('grid')}
              className='h-8 w-8 p-0'
            >
              <LayoutGrid className='h-4 w-4' />
            </Button>
          </div>
        </div>
      </div>

      {/* File List or Grid View */}
      <div>
        {viewMode === 'list' ? (
          <FileListView
            files={files}
            currentPath={currentPath}
            favorites={favorites}
            playingPath={playingPath}
            isVirtualFolder={isVirtualFolder}
            editableFolders={editableFolders}
            onFileClick={handleFileClick}
            onFolderHover={handleFolderHover}
            onParentDirectory={handleParentDirectory}
            onFavoriteToggle={handleFavoriteToggle}
            onContextSetIcon={handleContextSetIcon}
            onContextRename={handleContextRename}
            onContextDelete={handleContextDelete}
            onContextDownload={handleContextDownload}
            onContextToggleFavorite={handleContextToggleFavorite}
            getViewCount={getViewCount}
            getIcon={getIcon}
          />
        ) : (
          <FileGridView
            files={files}
            currentPath={currentPath}
            favorites={favorites}
            playingPath={playingPath}
            isVirtualFolder={isVirtualFolder}
            editableFolders={editableFolders}
            onFileClick={handleFileClick}
            onFolderHover={handleFolderHover}
            onParentDirectory={handleParentDirectory}
            onFavoriteToggle={handleFavoriteToggle}
            onContextSetIcon={handleContextSetIcon}
            onContextRename={handleContextRename}
            onContextDelete={handleContextDelete}
            onContextDownload={handleContextDownload}
            onContextToggleFavorite={handleContextToggleFavorite}
            getViewCount={getViewCount}
            getIcon={getIcon}
          />
        )}
      </div>
    </div>
  )
}

export function FileList(props: FileListProps) {
  return (
    <Suspense fallback={<div className='flex items-center justify-center h-full'>Loading...</div>}>
      <FileListInner key={props.currentPath} {...props} />
    </Suspense>
  )
}
