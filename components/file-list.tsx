'use client'

import { Suspense, useState } from 'react'
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
  Image as ImageIcon,
  FileQuestion,
  FileText,
  Star,
  List,
  LayoutGrid,
  FolderPlus,
  FilePlus,
  Trash2,
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

interface FileListProps {
  files: FileItem[]
  currentPath: string
  initialViewMode: 'list' | 'grid'
  initialFavorites?: string[]
  editableFolders: string[]
}

function FileListInner({
  files: initialFiles,
  currentPath,
  initialViewMode,
  initialFavorites = [],
  editableFolders,
}: FileListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  // Use React Query for files with SSR initial data
  const { data: filesData } = useFiles(currentPath, initialFiles)
  const prefetchFiles = usePrefetchFiles()

  // Ensure files is ALWAYS an array, no matter what
  const files = Array.isArray(filesData)
    ? filesData
    : Array.isArray(initialFiles)
      ? initialFiles
      : []

  // Use React Query for real-time settings
  const {
    settings,
    setViewMode: updateViewMode,
    toggleFavorite: updateFavorite,
  } = useSettings(currentPath)

  // Use server settings from React Query, fallback to initial values
  const viewMode = settings.viewMode || initialViewMode
  const favorites = settings.favorites || initialFavorites

  // State for dialogs
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
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
      // For audio/video, use 'playing' parameter (this stops any current playback)
      // For images/text/other files, use 'viewing' parameter (this keeps audio/video playing)
      const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO

      if (isMediaFile) {
        // Clear any viewing state and set playing
        params.delete('viewing')
        params.set('playing', file.path)
        params.set('dir', currentPath)
        params.set('autoplay', 'true')
      } else {
        // Keep playing state but set viewing
        params.set('viewing', file.path)
        params.set('dir', currentPath)
      }

      // Use replace to avoid adding file opens to browser history
      router.replace(`/?${params.toString()}`, { scroll: false })
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

  const getIcon = (type: MediaType, isPlaying: boolean = false, isAudioFile: boolean = false) => {
    // Show play/pause icon for currently playing audio files
    if (isPlaying && isAudioFile) {
      return <Play className='h-5 w-5 text-primary' />
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

  return (
    <div className='flex flex-col'>
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Empty Folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the folder &ldquo;{currentFolderName}&rdquo;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteFolderMutation.error && (
            <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
              {deleteFolderMutation.error.message}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFolderMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFolderMutation.mutate()}
              disabled={deleteFolderMutation.isPending}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {deleteFolderMutation.isPending ? 'Deleting...' : 'Delete'}
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
              if (e.key === 'Enter' && newItemName.trim()) createFolderMutation.mutate(newItemName)
            }}
            autoFocus
            disabled={createFolderMutation.isPending}
          />
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
              disabled={createFolderMutation.isPending || !newItemName.trim()}
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
              if (e.key === 'Enter' && newItemName.trim()) createFileMutation.mutate(newItemName)
            }}
            autoFocus
            disabled={createFileMutation.isPending}
          />
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
              disabled={createFileMutation.isPending || !newItemName.trim()}
            >
              {createFileMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Breadcrumb Navigation with Toolbar */}
      <div className='p-1.5 lg:p-2 border-b border-border bg-muted/30 shrink-0'>
        <div className='flex items-center justify-between gap-1.5 lg:gap-2'>
          <Breadcrumbs
            currentPath={currentPath}
            onNavigate={handleBreadcrumbClick}
            onFolderHover={handleFolderHover}
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
                {/* Show delete button only when inside an empty folder */}
                {currentPath !== '' && files.length === 0 && (
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={() => {
                      deleteFolderMutation.reset()
                      setShowDeleteConfirm(true)
                    }}
                    className='text-destructive hover:text-destructive h-8 w-8'
                    title='Delete this empty folder'
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                )}
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
                  return (
                    <TableRow
                      key={file.path}
                      className={`cursor-pointer hover:bg-muted/50 select-none group ${
                        playingPath === file.path ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => handleFileClick(file)}
                      onMouseEnter={() => file.isDirectory && handleFolderHover(file.path)}
                    >
                      <TableCell className='w-12'>
                        {getIcon(
                          file.type,
                          playingPath === file.path,
                          file.type === MediaType.AUDIO,
                        )}
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
                        {file.isDirectory ? '' : formatFileSize(file.size)}
                      </TableCell>
                    </TableRow>
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
                return (
                  <Card
                    key={file.path}
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
                          {getIcon(
                            file.type,
                            playingPath === file.path,
                            file.type === MediaType.AUDIO,
                          ) && (
                            <div className='scale-[2.5]'>
                              {getIcon(
                                file.type,
                                playingPath === file.path,
                                file.type === MediaType.AUDIO,
                              )}
                            </div>
                          )}
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
