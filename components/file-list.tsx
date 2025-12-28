'use client'

import { Suspense, useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { isPathEditable } from '@/lib/utils'
import {
  Folder,
  Music,
  Video,
  ArrowUp,
  Play,
  Pause,
  Image as ImageIcon,
  FileQuestion,
  FileText,
  Star,
  List,
  LayoutGrid,
  FolderPlus,
  FilePlus,
  Eye,
  AlertCircle,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { useSettings } from '@/lib/use-settings'
import { useFiles, usePrefetchFiles } from '@/lib/use-files'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useViewStats } from '@/lib/use-view-stats'
import { IconEditorDialog } from '@/components/icon-editor-dialog'
import { getIconComponent } from '@/lib/icon-utils'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { usePaste } from '@/lib/use-paste'
import { PasteDialog } from '@/components/paste-dialog'
import { FileContextMenu } from '@/components/file-context-menu'

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
  const queryClient = useQueryClient()
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

  // State for dialogs
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showIconEditor, setShowIconEditor] = useState(false)
  const [editingItem, setEditingItem] = useState<{ path: string; name: string } | null>(null)
  const [itemToDelete, setItemToDelete] = useState<FileItem | null>(null)
  const [newItemName, setNewItemName] = useState('')

  // Check if current directory is editable using client-side utility
  const isEditable = isPathEditable(currentPath || '', editableFolders)

  // Mutation for creating folders
  const createFolderMutation = useMutation({
    mutationFn: async (folderName: string) => {
      const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'folder', path: folderPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create folder')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setShowCreateFolder(false)
      setNewItemName('')
    },
  })

  // Mutation for creating files
  const createFileMutation = useMutation({
    mutationFn: async (fileName: string) => {
      const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
      const finalFilePath = filePath.includes('.') ? filePath : `${filePath}.txt`
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', path: finalFilePath, content: '' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create file')
      }
      return { data: await res.json(), filePath: finalFilePath }
    },
    onSuccess: ({ filePath }) => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setShowCreateFile(false)
      setNewItemName('')
      // Open the new file for editing
      const params = new URLSearchParams(searchParams)
      params.set('viewing', filePath)
      // Use replace to avoid adding file opens to browser history
      router.replace(`/?${params.toString()}`, { scroll: false })
    },
  })

  // Mutation for deleting folders
  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete folder')
      }
      return res.json()
    },
    onSuccess: () => {
      setShowDeleteConfirm(false)
      // Navigate to parent folder
      const params = new URLSearchParams(searchParams)
      const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
      if (pathParts.length > 1) {
        params.set('dir', pathParts.slice(0, -1).join('/'))
      } else {
        params.delete('dir')
      }
      router.push(`/?${params.toString()}`, { scroll: false })
    },
  })

  // Mutation for deleting individual files/folders
  const deleteItemMutation = useMutation({
    mutationFn: async (itemPath: string) => {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setShowDeleteConfirm(false)
      setItemToDelete(null)
    },
  })

  // Mutation for renaming files/folders
  const renameMutation = useMutation({
    mutationFn: async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const pathParts = oldPath.split(/[/\\]/).filter(Boolean)
      const parentPath = pathParts.slice(0, -1).join('/')
      const newPath = parentPath ? `${parentPath}/${newName}` : newName

      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to rename')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setShowRenameDialog(false)
      setEditingItem(null)
      setNewItemName('')
    },
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

  const getIcon = (
    type: MediaType,
    filePath: string,
    isAudioFile: boolean = false,
    isVideoFile: boolean = false,
  ) => {
    // Determine color based on type
    const getColorClass = (mediaType: MediaType) => {
      switch (mediaType) {
        case MediaType.FOLDER:
          return 'text-blue-500'
        case MediaType.AUDIO:
          return 'text-purple-500'
        case MediaType.VIDEO:
          return 'text-red-500'
        case MediaType.IMAGE:
          return 'text-green-500'
        case MediaType.TEXT:
          return 'text-cyan-500'
        case MediaType.OTHER:
          return 'text-yellow-500'
        default:
          return 'text-yellow-500'
      }
    }

    // Check for custom icon first
    const customIconName = customIcons[filePath]
    if (customIconName) {
      const CustomIcon = getIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon className={`h-5 w-5 ${getColorClass(type)}`} />
      }
    }

    // Show play/pause icon only if this file is actually loaded in the media player
    // Check both the URL parameter AND the media player store to avoid flickering
    const isCurrentFile = playingPath === filePath && currentFile === filePath

    if (isCurrentFile && (isAudioFile || isVideoFile)) {
      const isActuallyPlaying =
        mediaPlayerIsPlaying &&
        ((isAudioFile && mediaType === 'audio') || (isVideoFile && mediaType === 'video'))

      if (isActuallyPlaying) {
        return <Play className='h-5 w-5 text-primary' />
      } else {
        return <Pause className='h-5 w-5 text-primary' />
      }
    }

    switch (type) {
      case MediaType.FOLDER:
        return <Folder className='h-5 w-5 text-blue-500' />
      case MediaType.AUDIO:
        return <Music className='h-5 w-5 text-purple-500' />
      case MediaType.VIDEO:
        return <Video className='h-5 w-5 text-red-500' />
      case MediaType.IMAGE:
        return <ImageIcon className='h-5 w-5 text-green-500' />
      case MediaType.TEXT:
        return <FileText className='h-5 w-5 text-cyan-500' />
      case MediaType.OTHER:
        return <FileQuestion className='h-5 w-5 text-yellow-500' />
      default:
        return <FileQuestion className='h-5 w-5 text-yellow-500' />
    }
  }

  const playingPath = searchParams.get('playing')

  // Handle navigation to parent directory
  const handleParentDirectory = () => {
    const params = new URLSearchParams(searchParams)
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
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {itemToDelete
                ? `Delete ${itemToDelete.isDirectory ? 'Folder' : 'File'}?`
                : 'Delete Empty Folder?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete ? (
                <>
                  Are you sure you want to delete &ldquo;{itemToDelete.name}&rdquo;?
                  {itemToDelete.isDirectory && (
                    <span className='block mt-1 text-sm'>(Only empty folders can be deleted)</span>
                  )}
                  <span className='block mt-2 text-sm font-medium'>
                    This action cannot be undone.
                  </span>
                </>
              ) : (
                <>
                  Are you sure you want to delete the folder &ldquo;{currentFolderName}&rdquo;? This
                  action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(deleteFolderMutation.error || deleteItemMutation.error) && (
            <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
              {(deleteFolderMutation.error || deleteItemMutation.error)?.message}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteFolderMutation.isPending || deleteItemMutation.isPending}
              onClick={() => {
                setItemToDelete(null)
                deleteFolderMutation.reset()
                deleteItemMutation.reset()
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (itemToDelete) {
                  deleteItemMutation.mutate(itemToDelete.path)
                } else {
                  deleteFolderMutation.mutate()
                }
              }}
              disabled={deleteFolderMutation.isPending || deleteItemMutation.isPending}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {deleteFolderMutation.isPending || deleteItemMutation.isPending
                ? 'Deleting...'
                : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder.</DialogDescription>
          </DialogHeader>
          <Input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder='Folder name'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newItemName.trim() && !folderExists)
                createFolderMutation.mutate(newItemName)
            }}
            autoFocus
            disabled={createFolderMutation.isPending}
            className={folderExists ? 'border-yellow-500' : ''}
          />
          {/* Folder exists warning */}
          {folderExists && (
            <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
              <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
              <div className='text-sm text-yellow-800 dark:text-yellow-200'>
                <p className='font-medium'>Folder already exists</p>
                <p className='text-xs mt-1 opacity-90'>
                  A folder with this name already exists in this directory.
                </p>
              </div>
            </div>
          )}
          {createFolderMutation.error && (
            <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
              {createFolderMutation.error.message}
            </div>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setShowCreateFolder(false)
                setNewItemName('')
                createFolderMutation.reset()
              }}
              disabled={createFolderMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createFolderMutation.mutate(newItemName)}
              disabled={createFolderMutation.isPending || !newItemName.trim() || folderExists}
            >
              {createFolderMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create File Dialog */}
      <Dialog open={showCreateFile} onOpenChange={setShowCreateFile}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New File</DialogTitle>
            <DialogDescription>
              Enter a name for the new file. .txt extension will be added if no extension is
              provided.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder='File name (e.g., notes.txt)'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newItemName.trim() && !fileExists)
                createFileMutation.mutate(newItemName)
            }}
            autoFocus
            disabled={createFileMutation.isPending}
            className={fileExists ? 'border-yellow-500' : ''}
          />
          {/* File exists warning */}
          {fileExists && (
            <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
              <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
              <div className='text-sm text-yellow-800 dark:text-yellow-200'>
                <p className='font-medium'>File already exists</p>
                <p className='text-xs mt-1 opacity-90'>
                  A file with this name already exists in this directory.
                </p>
              </div>
            </div>
          )}
          {createFileMutation.error && (
            <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
              {createFileMutation.error.message}
            </div>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setShowCreateFile(false)
                setNewItemName('')
                createFileMutation.reset()
              }}
              disabled={createFileMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createFileMutation.mutate(newItemName)}
              disabled={createFileMutation.isPending || !newItemName.trim() || fileExists}
            >
              {createFileMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {editingItem?.name}</DialogTitle>
            <DialogDescription>
              Enter a new name for this{' '}
              {editingItem && files.find((f) => f.path === editingItem.path)?.isDirectory
                ? 'folder'
                : 'file'}
              .
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder='New name'
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                newItemName.trim() &&
                editingItem &&
                newItemName !== editingItem.name &&
                !renameTargetExists
              )
                renameMutation.mutate({ oldPath: editingItem.path, newName: newItemName })
            }}
            autoFocus
            disabled={renameMutation.isPending}
            className={renameTargetExists ? 'border-yellow-500' : ''}
          />
          {/* Name already exists warning */}
          {renameTargetExists && (
            <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
              <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
              <div className='text-sm text-yellow-800 dark:text-yellow-200'>
                <p className='font-medium'>Name already exists</p>
                <p className='text-xs mt-1 opacity-90'>
                  A{' '}
                  {editingItem && files.find((f) => f.path === editingItem.path)?.isDirectory
                    ? 'folder'
                    : 'file'}{' '}
                  with this name already exists in this directory.
                </p>
              </div>
            </div>
          )}
          {renameMutation.error && (
            <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
              {renameMutation.error.message}
            </div>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setShowRenameDialog(false)
                setEditingItem(null)
                setNewItemName('')
                renameMutation.reset()
              }}
              disabled={renameMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingItem) {
                  renameMutation.mutate({ oldPath: editingItem.path, newName: newItemName })
                }
              }}
              disabled={
                renameMutation.isPending ||
                !newItemName.trim() ||
                newItemName === editingItem?.name ||
                renameTargetExists
              }
            >
              {renameMutation.isPending ? 'Renaming...' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* File List */}
      <div>
        {files.length === 0 && !currentPath ? (
          <div className='text-center py-12 text-muted-foreground'>
            <Folder className='h-12 w-12 mx-auto mb-4 opacity-50' />
            <p>No media files found in this directory</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className='sm:px-4 py-2'>
            <Table>
              <TableBody>
                {/* Parent directory entry - only show when not at root */}
                {currentPath && (
                  <TableRow
                    className='cursor-pointer hover:bg-muted/50 select-none'
                    onClick={handleParentDirectory}
                  >
                    <TableCell className='w-12'>
                      <ArrowUp className='h-5 w-5 text-muted-foreground' />
                    </TableCell>
                    <TableCell className='font-medium'>..</TableCell>
                    <TableCell className='w-32 text-right text-muted-foreground'></TableCell>
                  </TableRow>
                )}
                {files.map((file) => {
                  const isFavorite = favorites.includes(file.path)
                  const viewCount = getViewCount(file.path)
                  const isFileEditable = isPathEditable(file.path, editableFolders)
                  return (
                    <FileContextMenu
                      key={file.path}
                      file={file}
                      onSetIcon={handleContextSetIcon}
                      onRename={handleContextRename}
                      onDelete={handleContextDelete}
                      onDownload={handleContextDownload}
                      isEditable={isFileEditable}
                    >
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 select-none group ${
                          playingPath === file.path ? 'bg-primary/10' : ''
                        }`}
                        onClick={() => handleFileClick(file)}
                        onMouseEnter={() => file.isDirectory && handleFolderHover(file.path)}
                      >
                        <TableCell className='w-12'>
                          <div className='flex items-center justify-center'>
                            {getIcon(
                              file.type,
                              file.path,
                              file.type === MediaType.AUDIO,
                              file.type === MediaType.VIDEO,
                            )}
                          </div>
                        </TableCell>
                        <TableCell className='font-medium'>
                          <div className='flex items-center gap-2'>
                            {!file.isDirectory && (
                              <button
                                onClick={(e) => handleFavoriteToggle(file.path, e)}
                                className='shrink-0 opacity-50 hover:opacity-100 transition-opacity'
                                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    isFavorite
                                      ? 'fill-yellow-400 text-yellow-400 opacity-100'
                                      : 'text-muted-foreground'
                                  }`}
                                />
                              </button>
                            )}
                            <span className='flex-1 truncate'>{file.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className='w-32 text-right text-muted-foreground'>
                          <div className='flex items-center justify-end gap-2'>
                            {!file.isDirectory && viewCount > 0 && (
                              <div
                                className='flex items-center gap-1 text-xs'
                                title={`${viewCount} views`}
                              >
                                <Eye className='h-3.5 w-3.5' />
                                <span>{viewCount}</span>
                              </div>
                            )}
                            <span className='w-20'>
                              {file.isDirectory ? '' : formatFileSize(file.size)}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    </FileContextMenu>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className='py-4 px-4'>
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
              {/* Parent directory card - only show when not at root */}
              {currentPath && (
                <Card
                  className='cursor-pointer hover:bg-muted/50 transition-colors select-none'
                  onClick={handleParentDirectory}
                >
                  <CardContent className='p-4 flex flex-col items-center justify-center aspect-video'>
                    <ArrowUp className='h-12 w-12 text-muted-foreground mb-2' />
                    <p className='text-sm font-medium text-center'>..</p>
                    <p className='text-xs text-muted-foreground text-center'>Parent Folder</p>
                  </CardContent>
                </Card>
              )}
              {files.map((file) => {
                const isFavorite = favorites.includes(file.path)
                const viewCount = getViewCount(file.path)
                const isFileEditable = isPathEditable(file.path, editableFolders)
                return (
                  <FileContextMenu
                    key={file.path}
                    file={file}
                    onSetIcon={handleContextSetIcon}
                    onRename={handleContextRename}
                    onDelete={handleContextDelete}
                    onDownload={handleContextDownload}
                    isEditable={isFileEditable}
                  >
                    <Card
                      className={`cursor-pointer hover:bg-muted/50 transition-colors select-none py-0 ${
                        playingPath === file.path ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => handleFileClick(file)}
                      onMouseEnter={() => file.isDirectory && handleFolderHover(file.path)}
                    >
                      <CardContent className='p-0 flex flex-col h-full'>
                        {/* Thumbnail/Icon */}
                        <div className='relative aspect-video bg-muted flex items-center justify-center overflow-hidden rounded-t-lg group'>
                          {/* Favorite star overlay - only for files, not folders */}
                          {!file.isDirectory && (
                            <button
                              onClick={(e) => handleFavoriteToggle(file.path, e)}
                              className={`absolute top-1.5 left-1.5 p-1 rounded-full transition-all z-10 ${
                                isFavorite
                                  ? 'bg-background/90 hover:bg-background shadow-sm'
                                  : 'bg-background/70 hover:bg-background/90 opacity-60 group-hover:opacity-100'
                              }`}
                              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                            >
                              <Star
                                className={`h-3.5 w-3.5 ${
                                  isFavorite
                                    ? 'fill-yellow-400 text-yellow-400'
                                    : 'text-muted-foreground'
                                }`}
                              />
                            </button>
                          )}
                          {/* View count badge - only for files with views */}
                          {!file.isDirectory && viewCount > 0 && (
                            <div
                              className='absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-background/90 backdrop-blur-sm shadow-sm z-10 flex items-center gap-1'
                              title={`${viewCount} views`}
                            >
                              <Eye className='h-3 w-3 text-muted-foreground' />
                              <span className='text-xs font-medium text-muted-foreground'>
                                {viewCount}
                              </span>
                            </div>
                          )}
                          {file.type === MediaType.VIDEO ? (
                            <img
                              src={`/api/thumbnail/${encodeURIComponent(file.path)}`}
                              alt={file.name}
                              className='w-full h-full object-cover rounded-t-lg'
                              onError={(e) => {
                                // Fallback to icon if thumbnail fails
                                e.currentTarget.style.display = 'none'
                                const parent = e.currentTarget.parentElement
                                if (parent) {
                                  const icon = parent.querySelector('.fallback-icon')
                                  if (icon) {
                                    icon.classList.remove('hidden')
                                  }
                                }
                              }}
                            />
                          ) : file.type === MediaType.IMAGE ? (
                            <img
                              src={`/api/media/${encodeURIComponent(file.path)}`}
                              alt={file.name}
                              className='w-full h-full object-cover rounded-t-lg'
                              onError={(e) => {
                                // Fallback to icon if image fails to load
                                e.currentTarget.style.display = 'none'
                                const parent = e.currentTarget.parentElement
                                if (parent) {
                                  const icon = parent.querySelector('.fallback-icon')
                                  if (icon) {
                                    icon.classList.remove('hidden')
                                  }
                                }
                              }}
                            />
                          ) : null}
                          <div
                            className={`fallback-icon ${
                              file.type === MediaType.VIDEO || file.type === MediaType.IMAGE
                                ? 'hidden'
                                : ''
                            }`}
                          >
                            <div className='scale-[2.5]'>
                              {getIcon(
                                file.type,
                                file.path,
                                file.type === MediaType.AUDIO,
                                file.type === MediaType.VIDEO,
                              )}
                            </div>
                          </div>
                        </div>
                        {/* File Info */}
                        <div className='p-3 flex flex-col gap-1'>
                          <p className='text-sm font-medium truncate' title={file.name}>
                            {file.name}
                          </p>
                          <div className='flex items-center justify-end text-xs text-muted-foreground'>
                            <span>{file.isDirectory ? '' : formatFileSize(file.size)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </FileContextMenu>
                )
              })}
            </div>
          </div>
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
