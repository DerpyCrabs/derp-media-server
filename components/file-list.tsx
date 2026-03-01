'use client'

import { Suspense, useState, useMemo, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileItem, MediaType } from '@/lib/types'
import { isPathEditable, getKnowledgeBaseRoot } from '@/lib/utils'
import { FolderPlus, FilePlus, List, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useFileWatcher } from '@/lib/use-file-watcher'
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ShareLink } from '@/lib/shares'

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
  useFileWatcher()
  const { playFile, isPlaying: mediaPlayerIsPlaying, mediaType, currentFile } = useMediaPlayer()

  // Use React Query for files with SSR initial data
  const { data: filesData } = useFiles(currentPath, initialFiles)
  const prefetchFiles = usePrefetchFiles()

  // Use view stats hook
  const { incrementView, getViewCount, getShareViewCount } = useViewStats()

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
  } = useFileMutations(currentPath)

  const queryClient = useQueryClient()

  // Revoke share mutation (for Shares virtual folder)
  const revokeShareMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch('/api/shares', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) throw new Error('Failed to revoke share')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] })
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    },
  })

  // Fetch shares for indicators
  const { data: sharesData } = useQuery({
    queryKey: ['shares'],
    queryFn: async () => {
      const res = await fetch('/api/shares')
      if (!res.ok) return { shares: [] }
      return res.json() as Promise<{ shares: ShareLink[] }>
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
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
  const [searchResults, setSearchResults] = useState<
    { path: string; name: string; snippet: string }[]
  >([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced KB search
  useEffect(() => {
    if (!searchQuery.trim() || !kbRoot) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/kb/search?q=${encodeURIComponent(searchQuery)}&root=${encodeURIComponent(kbRoot)}`,
        )
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.results || [])
        } else {
          setSearchResults([])
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
      searchDebounceRef.current = null
    }, 300)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery, kbRoot])

  // Check if we're in a virtual folder
  const isVirtualFolder =
    currentPath === VIRTUAL_FOLDERS.MOST_PLAYED ||
    currentPath === VIRTUAL_FOLDERS.FAVORITES ||
    currentPath === VIRTUAL_FOLDERS.SHARES

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

  // Prefetch folder contents and KB recent on hover
  const handleFolderHover = (folderPath: string) => {
    prefetchFiles(folderPath)
    if (getKnowledgeBaseRoot(folderPath, knowledgeBases)) {
      queryClient.prefetchQuery({
        queryKey: ['kb-recent', folderPath],
        queryFn: async () => {
          const res = await fetch(`/api/kb/recent?root=${encodeURIComponent(folderPath)}`)
          if (!res.ok) throw new Error('Failed to fetch recent')
          const data = await res.json()
          return data.results || []
        },
        staleTime: 1000 * 60,
      })
    }
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

  const handleKbResultClick = (filePath: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('dir', currentPath)
    params.set('viewing', filePath)
    setSearchQuery('') // Clear search to show the file
    router.replace(`/?${params.toString()}`, { scroll: false })
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
    if (renameMutation.isPending) return false
    return files.some(
      (f) => f.path !== editingItem.path && f.name.toLowerCase() === newItemName.toLowerCase(),
    )
  }, [newItemName, files, editingItem, renameMutation.isPending])

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
    const url = `${window.location.origin}/share/${file.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
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

  const getShareForPath = (path: string): ShareLink | null => {
    return shares.find((s) => s.path === path) || null
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
          if (itemToDelete?.shareToken) {
            revokeShareMutation.mutate(itemToDelete.shareToken, {
              onSuccess: () => {
                setShowDeleteConfirm(false)
                setItemToDelete(null)
                revokeShareMutation.reset()
              },
            })
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

      {/* Create Folder Dialog */}
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

      {/* Create File Dialog */}
      <CreateFileDialog
        isOpen={showCreateFile}
        onOpenChange={setShowCreateFile}
        fileName={newItemName}
        onFileNameChange={setNewItemName}
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

      {/* Rename Dialog */}
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

      {/* Move To Dialog */}
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

      {/* Copy To Dialog */}
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

      {/* Share Dialog */}
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
        existingShare={shareTarget ? getShareForPath(shareTarget.path) : null}
      />

      {/* Breadcrumb Navigation with Toolbar */}
      <div className='p-1.5 lg:p-2 border-b border-border bg-muted/30 shrink-0'>
        <div className='flex flex-wrap items-center justify-between gap-1.5 lg:gap-2'>
          <Breadcrumbs
            currentPath={currentPath}
            onNavigate={handleBreadcrumbClick}
            onFolderHover={handleFolderHover}
            customIcons={customIcons}
            onContextSetIcon={handleContextSetIcon}
            onContextRename={handleContextRename}
            onContextDelete={handleContextDelete}
            onContextDownload={handleContextDownload}
            onContextToggleFavorite={handleContextToggleFavorite}
            onContextShare={handleContextShare}
            favorites={favorites}
            editableFolders={editableFolders}
            shares={shares}
          />
          {inKb && (
            <div className='w-full md:w-auto md:flex-1 md:min-w-0 md:max-w-[200px] lg:max-w-[260px] basis-full md:basis-auto order-last md:order-0'>
              <Input
                type='search'
                placeholder='Search notes...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='h-8 w-full'
              />
            </div>
          )}
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

      {/* File List or Grid View, or KB Search Results */}
      <div className='flex flex-col min-h-0 flex-1 overflow-hidden'>
        {searchQuery.trim() ? (
          <KbSearchResults
            results={searchResults}
            query={searchQuery}
            isLoading={searchLoading}
            currentPath={currentPath}
            onResultClick={handleKbResultClick}
          />
        ) : (
          <>
            {inKb && currentPath && (
              <KbDashboard scopePath={currentPath} onFileClick={handleKbResultClick} />
            )}
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
                onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
                onContextShare={handleContextShare}
                onContextCopyShareLink={handleContextCopyShareLink}
                onContextMove={handleContextMove}
                onContextCopy={editableFolders.length > 0 ? handleContextCopy : undefined}
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
                onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
                onContextShare={handleContextShare}
                onContextCopyShareLink={handleContextCopyShareLink}
                onContextMove={handleContextMove}
                onContextCopy={editableFolders.length > 0 ? handleContextCopy : undefined}
                hasEditableFolders={editableFolders.length > 0}
                onMoveFile={handleMoveFile}
                shares={shares}
                knowledgeBases={knowledgeBases}
                getViewCount={getViewCount}
                getShareViewCount={getShareViewCount}
                getIcon={getIcon}
              />
            )}
          </>
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
