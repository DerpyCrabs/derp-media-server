'use client'

import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize, getMediaType } from '@/lib/media-utils'
import {
  FolderPlus,
  FilePlus,
  List,
  LayoutGrid,
  ArrowUp,
  Download,
  ChevronRight,
  Folder,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogPopup,
  DialogTitle,
  DialogContent,
  DialogHeader,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useFileIcon } from '@/lib/use-file-icon'
import { useFileWatcher } from '@/lib/use-file-watcher'
import { FileContextMenu } from '@/components/file-context-menu'
import { RenameDialog, DeleteConfirmDialog } from '@/components/file-dialogs'
import { MoveToDialog } from '@/components/move-to-dialog'
import { TextViewer } from '@/components/text-viewer'
import { KbSearchResults } from '@/components/kb-search-results'
import { KbDashboard } from '@/components/kb-dashboard'

interface ShareRestrictions {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

interface ShareInfo {
  token: string
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  restrictions?: ShareRestrictions
  isKnowledgeBase?: boolean
}

interface SharedFolderBrowserProps {
  token: string
  shareInfo: ShareInfo
  searchParams: { dir?: string; viewing?: string; playing?: string }
  adminViewMode?: 'list' | 'grid'
}

export function SharedFolderBrowser(props: SharedFolderBrowserProps) {
  return (
    <Suspense
      fallback={<div className='flex items-center justify-center h-screen'>Loading...</div>}
    >
      <SharedFolderBrowserInner {...props} />
    </Suspense>
  )
}

function SharedFolderBrowserInner({
  token,
  shareInfo,
  adminViewMode = 'list',
}: SharedFolderBrowserProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  useFileWatcher()

  const currentSubDir = searchParams.get('dir') || ''
  const viewingPath = searchParams.get('viewing')
  const playingPath = searchParams.get('playing')

  const canUpload = shareInfo.editable && shareInfo.restrictions?.allowUpload !== false
  const canEdit = shareInfo.editable && shareInfo.restrictions?.allowEdit !== false
  const canDelete = shareInfo.editable && shareInfo.restrictions?.allowDelete !== false

  const storageKey = `share-viewmode-${token}`
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey)
      if (saved === 'list' || saved === 'grid') return saved
    }
    return adminViewMode
  })

  const handleViewModeChange = useCallback(
    (mode: 'list' | 'grid') => {
      setViewMode(mode)
      try {
        localStorage.setItem(storageKey, mode)
      } catch {}
    },
    [storageKey],
  )
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [newItemName, setNewItemName] = useState('')

  const [inlineMode, setInlineMode] = useState<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inlineMode === 'file') fileInputRef.current?.focus()
    else if (inlineMode === 'folder') folderInputRef.current?.focus()
  }, [inlineMode])

  const { getIcon } = useFileIcon({
    customIcons: {},
    playingPath,
    currentFile: null,
    mediaPlayerIsPlaying: false,
    mediaType: null,
  })

  const stripSharePrefix = useCallback(
    (filePath: string) => {
      const sharePath = shareInfo.path.replace(/\\/g, '/')
      const fwd = filePath.replace(/\\/g, '/')
      return fwd.startsWith(sharePath + '/') ? fwd.slice(sharePath.length + 1) : fwd
    },
    [shareInfo.path],
  )

  const encodePathForUrl = useCallback(
    (filePath: string) => {
      return stripSharePrefix(filePath).split('/').map(encodeURIComponent).join('/')
    },
    [stripSharePrefix],
  )

  const getShareMediaUrl = useCallback(
    (filePath: string) => {
      return `/api/share/${token}/media/${encodePathForUrl(filePath)}`
    },
    [token, encodePathForUrl],
  )

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['share-files', token, currentSubDir],
    queryFn: async () => {
      const res = await fetch(`/api/share/${token}/files?dir=${encodeURIComponent(currentSubDir)}`)
      if (!res.ok) throw new Error('Failed to load files')
      const data = await res.json()
      return data.files as FileItem[]
    },
  })

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      const subPath = currentSubDir ? `${currentSubDir}/${name}` : name
      const res = await fetch(`/api/share/${token}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'folder', path: subPath }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to create folder')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share-files', token, currentSubDir] })
      setShowCreateFolder(false)
      setNewItemName('')
    },
  })

  const inKb = shareInfo.isKnowledgeBase ?? false
  const createFileMutation = useMutation({
    mutationFn: async (name: string) => {
      const defaultExt = inKb ? '.md' : '.txt'
      const fileName = name.includes('.') ? name : `${name}${defaultExt}`
      const subPath = currentSubDir ? `${currentSubDir}/${fileName}` : fileName
      const res = await fetch(`/api/share/${token}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', path: subPath, content: '' }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to create file')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share-files', token, currentSubDir] })
      setShowCreateFile(false)
      setNewItemName('')
    },
  })

  const deleteItemMutation = useMutation({
    mutationFn: async (filePath: string) => {
      const res = await fetch(`/api/share/${token}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: stripSharePrefix(filePath) }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to delete')
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['share-files', token, currentSubDir] }),
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<
    { path: string; name: string; snippet: string }[]
  >([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!searchQuery.trim() || !inKb) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const dirParam = currentSubDir ? `&dir=${encodeURIComponent(currentSubDir)}` : ''
        const res = await fetch(
          `/api/share/${token}/kb/search?q=${encodeURIComponent(searchQuery)}${dirParam}`,
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
  }, [searchQuery, inKb, token, currentSubDir])

  const handleKbResultClick = useCallback(
    (filePath: string) => {
      const params = new URLSearchParams(searchParams)
      params.set('viewing', filePath)
      params.delete('playing')
      setSearchQuery('')
      router.replace(`/share/${token}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, token],
  )

  const kbRecentUrl = useMemo(() => {
    const dirParam = currentSubDir ? `&dir=${encodeURIComponent(currentSubDir)}` : ''
    return `/api/share/${token}/kb/recent?root=${encodeURIComponent(shareInfo.path)}${dirParam}`
  }, [token, shareInfo.path, currentSubDir])

  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingItem, setDeletingItem] = useState<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<FileItem | null>(null)

  const renameMutation = useMutation({
    mutationFn: async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const relativeOld = stripSharePrefix(oldPath)
      const parts = relativeOld.split('/').filter(Boolean)
      const parentPath = parts.slice(0, -1).join('/')
      const relativeNew = parentPath ? `${parentPath}/${newName}` : newName
      const res = await fetch(`/api/share/${token}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: relativeOld, newPath: relativeNew }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to rename')
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['share-files', token, currentSubDir] }),
  })

  const moveMutation = useMutation({
    mutationFn: async ({
      sourceRelative,
      destRelative,
    }: {
      sourceRelative: string
      destRelative: string
    }) => {
      const fileName = sourceRelative.split('/').pop()!
      const newPath = destRelative ? `${destRelative}/${fileName}` : fileName
      const res = await fetch(`/api/share/${token}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: sourceRelative, newPath }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to move')
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['share-files', token, currentSubDir] }),
  })

  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  const parentSubDir = useMemo(() => {
    if (!currentSubDir) return ''
    const parts = currentSubDir.split('/').filter(Boolean)
    return parts.slice(0, -1).join('/')
  }, [currentSubDir])

  const canDropOnParent = canEdit && !!currentSubDir

  const canDropOn = useCallback(
    (targetPath: string) => {
      if (!draggedPath || draggedPath === targetPath) return false
      if (targetPath.startsWith(draggedPath + '/')) return false
      return true
    },
    [draggedPath],
  )

  const handleMoveFile = useCallback(
    (sourceFullPath: string, destDir: string) => {
      const sourceRelative = stripSharePrefix(sourceFullPath)
      moveMutation.mutate({ sourceRelative, destRelative: destDir })
    },
    [stripSharePrefix, moveMutation],
  )

  const enableDrag = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

  const handleContextMoveFile = useCallback(
    (file: FileItem) => {
      setMoveTarget(file)
      moveMutation.reset()
      setShowMoveDialog(true)
    },
    [moveMutation],
  )

  const handleDialogMove = useCallback(
    (destDir: string) => {
      if (!moveTarget) return
      const sourceRelative = stripSharePrefix(moveTarget.path)
      moveMutation.mutate(
        { sourceRelative, destRelative: destDir },
        {
          onSuccess: () => {
            setShowMoveDialog(false)
            setMoveTarget(null)
            moveMutation.reset()
          },
        },
      )
    },
    [moveTarget, stripSharePrefix, moveMutation],
  )

  const renameTargetExists = useMemo(() => {
    if (!renameNewName.trim() || !renamingItem) return false
    if (renameMutation.isPending) return false
    return files.some(
      (f) => f.path !== renamingItem.path && f.name.toLowerCase() === renameNewName.toLowerCase(),
    )
  }, [renameNewName, files, renamingItem, renameMutation.isPending])

  const handleContextRename = useCallback((file: FileItem) => {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRenameDialog(true)
  }, [])

  const handleContextDelete = useCallback((file: FileItem) => {
    setDeletingItem(file)
    setShowDeleteDialog(true)
  }, [])

  const navigate = useCallback(
    (subDir: string) => {
      const params = new URLSearchParams(searchParams)
      params.delete('viewing')
      params.delete('playing')
      if (subDir) params.set('dir', subDir)
      else params.delete('dir')
      router.push(`/share/${token}?${params.toString()}`, { scroll: false })
    },
    [router, token, searchParams],
  )

  const trackShareView = useCallback(
    (filePath: string) => {
      fetch(`/api/share/${token}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: stripSharePrefix(filePath) }),
      }).catch(() => {})
    },
    [token, stripSharePrefix],
  )

  const handleFileClick = useCallback(
    (file: FileItem) => {
      if (file.isDirectory) {
        navigate(stripSharePrefix(file.path))
      } else {
        trackShareView(file.path)
        const params = new URLSearchParams(searchParams)
        const ext = file.path.split('.').pop()?.toLowerCase() || ''
        const type = getMediaType(ext)
        const isMedia = type === 'audio' || type === 'video'
        if (isMedia) {
          params.set('playing', file.path)
          params.delete('viewing')
        } else {
          params.set('viewing', file.path)
          params.delete('playing')
        }
        router.replace(`/share/${token}?${params.toString()}`, { scroll: false })
      }
    },
    [stripSharePrefix, navigate, searchParams, router, token, trackShareView],
  )

  const handleParentDirectory = useCallback(() => {
    if (!currentSubDir) return
    const parts = currentSubDir.split('/').filter(Boolean)
    if (parts.length <= 1) {
      navigate('')
    } else {
      navigate(parts.slice(0, -1).join('/'))
    }
  }, [currentSubDir, navigate])

  const handleDownload = useCallback(
    (file: FileItem) => {
      const a = document.createElement('a')
      a.href = `/api/share/${token}/download?path=${encodeURIComponent(stripSharePrefix(file.path))}`
      a.download = file.name
      a.click()
    },
    [token, stripSharePrefix],
  )

  const closeViewer = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    params.delete('playing')
    router.replace(`/share/${token}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, token])

  const handleOpenInNewTab = useCallback(
    (file: FileItem) => {
      if (!file.isDirectory || file.isVirtual) return
      const sharePathNorm = shareInfo.path.replace(/\\/g, '/')
      const pathNorm = file.path.replace(/\\/g, '/')
      const subPath = pathNorm === sharePathNorm ? '' : stripSharePrefix(file.path)
      const params = new URLSearchParams(searchParams)
      params.delete('viewing')
      params.delete('playing')
      if (subPath) params.set('dir', subPath)
      else params.delete('dir')
      const url = `${window.location.origin}/share/${token}?${params.toString()}`
      window.open(url, '_blank')
    },
    [token, shareInfo.path, searchParams, stripSharePrefix],
  )

  // Build breadcrumbs relative to share root
  const breadcrumbs = useMemo(() => {
    const parts = currentSubDir ? currentSubDir.split('/').filter(Boolean) : []
    return [
      { name: shareInfo.name, path: '' },
      ...parts.map((part, i) => ({
        name: part,
        path: parts.slice(0, i + 1).join('/'),
      })),
    ]
  }, [currentSubDir, shareInfo.name])

  return (
    <div className='min-h-screen'>
      {/* Viewers for playing/viewing files */}
      {viewingPath && (
        <ShareInlineViewer
          token={token}
          shareInfo={shareInfo}
          filePath={viewingPath}
          files={files}
          getMediaUrl={getShareMediaUrl}
          onNavigate={handleFileClick}
          onClose={closeViewer}
        />
      )}
      {playingPath && (
        <ShareMediaPlayer
          filePath={playingPath}
          files={files}
          getMediaUrl={getShareMediaUrl}
          onNavigate={handleFileClick}
          onClose={closeViewer}
        />
      )}

      <div className='container mx-auto lg:p-4'>
        <Card className='py-0 rounded-none lg:rounded-xl'>
          {/* Toolbar */}
          <div className='p-1.5 lg:p-2 border-b border-border bg-muted/30 shrink-0'>
            <div className='flex flex-wrap items-center justify-between gap-1.5 lg:gap-2'>
              {/* Breadcrumbs */}
              <div className='flex items-center gap-1 lg:gap-2 flex-wrap min-w-0 flex-1'>
                {breadcrumbs.map((crumb, index) => {
                  const fullPath = crumb.path
                    ? `${shareInfo.path.replace(/\\/g, '/')}/${crumb.path}`
                    : shareInfo.path.replace(/\\/g, '/')
                  const folderItem: FileItem = {
                    name: crumb.name,
                    path: fullPath,
                    type: MediaType.FOLDER,
                    size: 0,
                    extension: '',
                    isDirectory: true,
                    isVirtual: false,
                  }
                  const button = (
                    <Button
                      variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
                      size='sm'
                      onClick={() => navigate(crumb.path)}
                      className='gap-1.5 text-sm h-8 px-2.5'
                    >
                      {index === 0 && <Folder className='h-4 w-4' />}
                      {crumb.name}
                    </Button>
                  )
                  return (
                    <div key={crumb.path} className='flex items-center gap-2'>
                      {index > 0 && <ChevronRight className='h-4 w-4 text-muted-foreground' />}
                      <FileContextMenu
                        file={folderItem}
                        onDownload={handleDownload}
                        onOpenInNewTab={handleOpenInNewTab}
                      >
                        {button}
                      </FileContextMenu>
                    </div>
                  )
                })}
              </div>
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
                {canUpload && (
                  <>
                    <Button
                      variant='outline'
                      size='icon'
                      onClick={() => {
                        setNewItemName('')
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

          {/* File list or KB search results */}
          {searchQuery.trim() ? (
            <KbSearchResults
              results={searchResults}
              query={searchQuery}
              isLoading={searchLoading}
              currentPath={
                shareInfo.path.replace(/\\/g, '/') + (currentSubDir ? `/${currentSubDir}` : '')
              }
              onResultClick={handleKbResultClick}
            />
          ) : isLoading ? (
            <div className='flex items-center justify-center py-12 text-muted-foreground'>
              Loading...
            </div>
          ) : (
            <>
              {inKb && (
                <KbDashboard
                  scopePath={shareInfo.path}
                  onFileClick={handleKbResultClick}
                  fetchUrl={kbRecentUrl}
                />
              )}
              {viewMode === 'list' ? (
                <div className='sm:px-4 py-2'>
                  <Table>
                    <TableBody>
                      {currentSubDir && (
                        <TableRow
                          className={`cursor-pointer hover:bg-muted/50 select-none ${
                            dragOverPath === '__parent__' ? 'bg-primary/20' : ''
                          }`}
                          onClick={handleParentDirectory}
                          onDragOver={(e) => {
                            if (!canDropOnParent || !draggedPath) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDragOverPath('__parent__')
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setDragOverPath(null)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDragOverPath(null)
                            if (draggedPath) {
                              handleMoveFile(draggedPath, parentSubDir)
                            }
                          }}
                        >
                          <TableCell className='w-12'>
                            <ArrowUp className='h-5 w-5 text-muted-foreground' />
                          </TableCell>
                          <TableCell className='font-medium'>..</TableCell>
                          <TableCell className='w-32 text-right text-muted-foreground'></TableCell>
                        </TableRow>
                      )}
                      {files.map((file) => {
                        const row = (
                          <TableRow
                            key={file.path}
                            className={`cursor-pointer hover:bg-muted/50 select-none ${playingPath === file.path ? 'bg-primary/10' : ''} ${
                              draggedPath === file.path ? 'opacity-50' : ''
                            } ${file.isDirectory && dragOverPath === file.path ? 'bg-primary/20' : ''}`}
                            draggable={canEdit && enableDrag}
                            onClick={() => handleFileClick(file)}
                            onDragStart={(e) => {
                              if (!canEdit) return
                              e.dataTransfer.setData('text/plain', file.path)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggedPath(file.path)
                            }}
                            onDragEnd={() => {
                              setDraggedPath(null)
                              setDragOverPath(null)
                            }}
                            onDragOver={(e) => {
                              if (!file.isDirectory || !canEdit || !draggedPath) return
                              if (!canDropOn(file.path)) return
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                              setDragOverPath(file.path)
                            }}
                            onDragLeave={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                if (dragOverPath === file.path) setDragOverPath(null)
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              setDragOverPath(null)
                              if (
                                draggedPath &&
                                file.isDirectory &&
                                canEdit &&
                                canDropOn(file.path)
                              ) {
                                handleMoveFile(draggedPath, stripSharePrefix(file.path))
                              }
                            }}
                          >
                            <TableCell className='w-12'>
                              <div className='flex items-center justify-center'>
                                {getIcon(
                                  file.type,
                                  file.path,
                                  file.type === MediaType.AUDIO,
                                  file.type === MediaType.VIDEO,
                                  file.isVirtual,
                                )}
                              </div>
                            </TableCell>
                            <TableCell className='font-medium'>
                              <span className='truncate block'>{file.name}</span>
                            </TableCell>
                            <TableCell className='w-48 text-right text-muted-foreground'>
                              <div className='flex items-center justify-end gap-2'>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  className='h-7 w-7'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDownload(file)
                                  }}
                                  title='Download'
                                >
                                  <Download className='h-3.5 w-3.5' />
                                </Button>
                                <span className='w-20'>
                                  {file.isDirectory ? '' : formatFileSize(file.size)}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                        return shareInfo.editable ? (
                          <FileContextMenu
                            key={file.path}
                            file={file}
                            isEditable
                            onDownload={handleDownload}
                            onRename={canEdit ? handleContextRename : undefined}
                            onDelete={canDelete ? handleContextDelete : undefined}
                            onMove={canEdit ? handleContextMoveFile : undefined}
                            onOpenInNewTab={file.isDirectory ? handleOpenInNewTab : undefined}
                          >
                            {row}
                          </FileContextMenu>
                        ) : (
                          row
                        )
                      })}
                      {inKb && canUpload && (
                        <TableRow
                          className='border-t bg-muted/20 hover:bg-muted/30'
                          onClick={(e) => e.stopPropagation()}
                        >
                          <TableCell colSpan={3} className='p-0'>
                            <div className='grid grid-cols-2 gap-px p-2'>
                              <div className='w-full min-w-0 flex flex-col gap-1'>
                                {inlineMode === 'file' ? (
                                  <>
                                    <Input
                                      ref={fileInputRef}
                                      value={inlineName}
                                      onChange={(e) => setInlineName(e.target.value)}
                                      placeholder={`File name (e.g. notes.${inKb ? 'md' : 'txt'})`}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const name = inlineName.trim()
                                          if (!name) return
                                          createFileMutation.mutate(name, {
                                            onSuccess: () => {
                                              setInlineMode(null)
                                              setInlineName('')
                                              createFileMutation.reset()
                                            },
                                          })
                                        } else if (e.key === 'Escape') {
                                          setInlineMode(null)
                                          setInlineName('')
                                        }
                                      }}
                                      onBlur={() => {
                                        setInlineMode(null)
                                        setInlineName('')
                                        createFileMutation.reset()
                                      }}
                                      disabled={createFileMutation.isPending}
                                      className={`h-8 text-sm ${
                                        createFileMutation.error
                                          ? 'border-destructive ring-2 ring-destructive/30'
                                          : ''
                                      }`}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    {createFileMutation.error && (
                                      <div className='flex items-start gap-1.5 rounded bg-destructive/10 border border-destructive/50 px-2 py-1.5 text-xs text-destructive'>
                                        <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                                        <span>{createFileMutation.error.message}</span>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type='button'
                                    onClick={() => {
                                      setInlineMode('file')
                                      setInlineName('')
                                    }}
                                    className='flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground transition-colors'
                                  >
                                    <FilePlus className='h-4 w-4' />
                                    New file
                                  </button>
                                )}
                              </div>
                              <div className='w-full min-w-0 flex flex-col gap-1'>
                                {inlineMode === 'folder' ? (
                                  <>
                                    <Input
                                      ref={folderInputRef}
                                      value={inlineName}
                                      onChange={(e) => setInlineName(e.target.value)}
                                      placeholder='Folder name'
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const name = inlineName.trim()
                                          if (!name) return
                                          createFolderMutation.mutate(name, {
                                            onSuccess: () => {
                                              setInlineMode(null)
                                              setInlineName('')
                                              createFolderMutation.reset()
                                            },
                                          })
                                        } else if (e.key === 'Escape') {
                                          setInlineMode(null)
                                          setInlineName('')
                                        }
                                      }}
                                      onBlur={() => {
                                        setInlineMode(null)
                                        setInlineName('')
                                        createFolderMutation.reset()
                                      }}
                                      disabled={createFolderMutation.isPending}
                                      className={`h-8 text-sm ${
                                        createFolderMutation.error
                                          ? 'border-destructive ring-2 ring-destructive/30'
                                          : ''
                                      }`}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    {createFolderMutation.error && (
                                      <div className='flex items-start gap-1.5 rounded bg-destructive/10 border border-destructive/50 px-2 py-1.5 text-xs text-destructive'>
                                        <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                                        <span>{createFolderMutation.error.message}</span>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type='button'
                                    onClick={() => {
                                      setInlineMode('folder')
                                      setInlineName('')
                                    }}
                                    className='flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground transition-colors'
                                  >
                                    <FolderPlus className='h-4 w-4' />
                                    New folder
                                  </button>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className='py-4 px-4'>
                  <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
                    {currentSubDir && (
                      <Card
                        className={`cursor-pointer hover:bg-muted/50 transition-colors select-none ${
                          dragOverPath === '__parent__' ? 'ring-2 ring-primary bg-primary/10' : ''
                        }`}
                        onClick={handleParentDirectory}
                        onDragOver={(e) => {
                          if (!canDropOnParent || !draggedPath) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          setDragOverPath('__parent__')
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setDragOverPath(null)
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverPath(null)
                          if (draggedPath) {
                            handleMoveFile(draggedPath, parentSubDir)
                          }
                        }}
                      >
                        <CardContent className='p-4 flex flex-col items-center justify-center aspect-video'>
                          <ArrowUp className='h-12 w-12 text-muted-foreground mb-2' />
                          <p className='text-sm font-medium text-center'>..</p>
                          <p className='text-xs text-muted-foreground text-center'>Parent Folder</p>
                        </CardContent>
                      </Card>
                    )}
                    {files.map((file) => {
                      const card = (
                        <Card
                          key={file.path}
                          className={`cursor-pointer hover:bg-muted/50 transition-colors select-none py-0 ${playingPath === file.path ? 'ring-2 ring-primary' : ''} ${
                            draggedPath === file.path ? 'opacity-50' : ''
                          } ${
                            file.isDirectory && dragOverPath === file.path
                              ? 'ring-2 ring-primary bg-primary/10'
                              : ''
                          }`}
                          draggable={canEdit && enableDrag}
                          onClick={() => handleFileClick(file)}
                          onDragStart={(e) => {
                            if (!canEdit) return
                            e.dataTransfer.setData('text/plain', file.path)
                            e.dataTransfer.effectAllowed = 'move'
                            setDraggedPath(file.path)
                          }}
                          onDragEnd={() => {
                            setDraggedPath(null)
                            setDragOverPath(null)
                          }}
                          onDragOver={(e) => {
                            if (!file.isDirectory || !canEdit || !draggedPath) return
                            if (!canDropOn(file.path)) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDragOverPath(file.path)
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              if (dragOverPath === file.path) setDragOverPath(null)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDragOverPath(null)
                            if (
                              draggedPath &&
                              file.isDirectory &&
                              canEdit &&
                              canDropOn(file.path)
                            ) {
                              handleMoveFile(draggedPath, stripSharePrefix(file.path))
                            }
                          }}
                        >
                          <CardContent className='p-0 flex flex-col h-full'>
                            <div className='relative aspect-video bg-muted flex items-center justify-center overflow-hidden rounded-t-lg'>
                              {file.type === MediaType.VIDEO ? (
                                <img
                                  src={`/api/share/${token}/thumbnail/${encodePathForUrl(file.path)}`}
                                  alt={file.name}
                                  className='w-full h-full object-cover rounded-t-lg'
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                  }}
                                />
                              ) : file.type === MediaType.IMAGE ? (
                                <img
                                  src={getShareMediaUrl(file.path)}
                                  alt={file.name}
                                  className='w-full h-full object-cover rounded-t-lg'
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                  }}
                                />
                              ) : (
                                <div className='scale-[2.5]'>
                                  {getIcon(
                                    file.type,
                                    file.path,
                                    file.type === MediaType.AUDIO,
                                    false,
                                    file.isVirtual,
                                  )}
                                </div>
                              )}
                            </div>
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
                      return shareInfo.editable ? (
                        <FileContextMenu
                          key={file.path}
                          file={file}
                          isEditable
                          onDownload={handleDownload}
                          onRename={canEdit ? handleContextRename : undefined}
                          onDelete={canDelete ? handleContextDelete : undefined}
                          onMove={canEdit ? handleContextMoveFile : undefined}
                          onOpenInNewTab={file.isDirectory ? handleOpenInNewTab : undefined}
                        >
                          {card}
                        </FileContextMenu>
                      ) : (
                        card
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Move To Dialog */}
      <MoveToDialog
        isOpen={showMoveDialog}
        onClose={() => {
          setShowMoveDialog(false)
          setMoveTarget(null)
          moveMutation.reset()
        }}
        fileName={moveTarget?.name || ''}
        filePath={moveTarget ? stripSharePrefix(moveTarget.path) : ''}
        onMove={handleDialogMove}
        isPending={moveMutation.isPending}
        error={moveMutation.error}
        shareToken={token}
        shareRootPath={shareInfo.path}
      />

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createFolderMutation.mutate(newItemName, {
                onSuccess: () => {
                  setShowCreateFolder(false)
                  setNewItemName('')
                  createFolderMutation.reset()
                },
              })
            }}
            className='space-y-4'
          >
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder='Folder name'
              autoFocus
            />
            <div className='flex justify-end gap-2'>
              <Button variant='outline' type='button' onClick={() => setShowCreateFolder(false)}>
                Cancel
              </Button>
              <Button
                type='submit'
                disabled={!newItemName.trim() || createFolderMutation.isPending}
              >
                {createFolderMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create File Dialog */}
      <Dialog open={showCreateFile} onOpenChange={setShowCreateFile}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create File</DialogTitle>
            <DialogDescription>
              Enter a name for the new file. .{inKb ? 'md' : 'txt'} extension will be added if no
              extension is provided.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createFileMutation.mutate(newItemName, {
                onSuccess: () => {
                  setShowCreateFile(false)
                  setNewItemName('')
                  createFileMutation.reset()
                },
              })
            }}
            className='space-y-4'
          >
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={inKb ? 'notes.md' : 'notes.txt'}
              autoFocus
            />
            <div className='flex justify-end gap-2'>
              <Button variant='outline' type='button' onClick={() => setShowCreateFile(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={!newItemName.trim() || createFileMutation.isPending}>
                {createFileMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <RenameDialog
        isOpen={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        itemName={renamingItem?.name || ''}
        newName={renameNewName}
        onNewNameChange={setRenameNewName}
        onRename={() => {
          if (renamingItem) {
            renameMutation.mutate(
              { oldPath: renamingItem.path, newName: renameNewName },
              {
                onSuccess: () => {
                  setShowRenameDialog(false)
                  setRenamingItem(null)
                  setRenameNewName('')
                  renameMutation.reset()
                },
              },
            )
          }
        }}
        isPending={renameMutation.isPending}
        error={renameMutation.error}
        nameExists={renameTargetExists}
        isDirectory={renamingItem?.isDirectory || false}
        onReset={() => {
          setShowRenameDialog(false)
          setRenamingItem(null)
          setRenameNewName('')
          renameMutation.reset()
        }}
      />

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        item={deletingItem}
        onDelete={() => {
          if (deletingItem) {
            deleteItemMutation.mutate(deletingItem.path, {
              onSuccess: () => {
                setShowDeleteDialog(false)
                setDeletingItem(null)
                deleteItemMutation.reset()
              },
            })
          }
        }}
        isPending={deleteItemMutation.isPending}
        error={deleteItemMutation.error}
        onReset={() => {
          setShowDeleteDialog(false)
          setDeletingItem(null)
          deleteItemMutation.reset()
        }}
      />
    </div>
  )
}

// Inline viewer for text/images/PDFs within the shared folder
function ShareInlineViewer({
  token,
  shareInfo,
  filePath,
  files,
  getMediaUrl,
  onNavigate,
  onClose,
}: {
  token: string
  shareInfo: ShareInfo
  filePath: string
  files: FileItem[]
  getMediaUrl: (path: string) => string
  onNavigate: (file: FileItem) => void
  onClose: () => void
}) {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const type = getMediaType(ext)
  const fileName = filePath.split(/[/\\]/).pop() || ''
  const mediaUrl = getMediaUrl(filePath)

  if (type === 'image') {
    const imageFiles = files.filter((f) => !f.isDirectory && getMediaType(f.extension) === 'image')
    return (
      <InlineImageViewer
        fileName={fileName}
        mediaUrl={mediaUrl}
        filePath={filePath}
        imageFiles={imageFiles}
        onNavigate={onNavigate}
        onClose={onClose}
      />
    )
  }

  if (type === 'pdf') {
    return <InlinePdfViewer fileName={fileName} mediaUrl={mediaUrl} onClose={onClose} />
  }

  if (type === 'text') {
    const shareFwd = shareInfo.path.replace(/\\/g, '/')
    const fileFwd = filePath.replace(/\\/g, '/')
    const relative = fileFwd.startsWith(shareFwd + '/')
      ? fileFwd.slice(shareFwd.length + 1)
      : fileFwd
    const downloadUrl = `/api/share/${token}/download?path=${encodeURIComponent(relative)}`
    return (
      <TextViewer
        shareMode={{
          token,
          shareInfo,
          mediaUrl,
          downloadUrl,
          filePath,
          onClose,
        }}
      />
    )
  }

  // For other types, just trigger download
  const a = document.createElement('a')
  const shareFwd = shareInfo.path.replace(/\\/g, '/')
  const fileFwd = filePath.replace(/\\/g, '/')
  const relative = fileFwd.startsWith(shareFwd + '/') ? fileFwd.slice(shareFwd.length + 1) : fileFwd
  a.href = `/api/share/${token}/download?path=${encodeURIComponent(relative)}`
  a.download = fileName
  a.click()
  onClose()
  return null
}

function InlineImageViewer({
  fileName,
  mediaUrl,
  filePath,
  imageFiles,
  onNavigate,
  onClose,
}: {
  fileName: string
  mediaUrl: string
  filePath: string
  imageFiles: FileItem[]
  onNavigate: (file: FileItem) => void
  onClose: () => void
}) {
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)

  const currentIndex = imageFiles.findIndex((f) => f.path === filePath)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < imageFiles.length - 1

  const goNext = useCallback(() => {
    if (!hasNext) return
    setZoom('fit')
    setRotation(0)
    onNavigate(imageFiles[currentIndex + 1])
  }, [hasNext, currentIndex, imageFiles, onNavigate])

  const goPrev = useCallback(() => {
    if (!hasPrev) return
    setZoom('fit')
    setRotation(0)
    onNavigate(imageFiles[currentIndex - 1])
  }, [hasPrev, currentIndex, imageFiles, onNavigate])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goNext, goPrev])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay className='bg-black/95' />
        <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
          <span className='sr-only'>
            <DialogTitle>{fileName}</DialogTitle>
          </span>
          <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
            <h2 className='text-white text-lg font-medium truncate flex-1'>{fileName}</h2>
            {imageFiles.length > 1 && (
              <span className='text-white text-sm shrink-0 px-4'>
                {currentIndex + 1} of {imageFiles.length}
              </span>
            )}
            <div className='flex items-center gap-2'>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setZoom((z) => Math.max((z === 'fit' ? 100 : z) - 25, 25))}
                className='text-white hover:bg-white/10'
              >
                <ZoomOut className='h-5 w-5' />
              </Button>
              <span className='text-white text-sm min-w-16 text-center'>
                {zoom === 'fit' ? 'Fit' : `${zoom}%`}
              </span>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setZoom((z) => Math.min((z === 'fit' ? 100 : z) + 25, 400))}
                className='text-white hover:bg-white/10'
              >
                <ZoomIn className='h-5 w-5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => {
                  setZoom('fit')
                  setRotation(0)
                }}
                className='text-white hover:bg-white/10'
              >
                <Maximize2 className='h-5 w-5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className='text-white hover:bg-white/10'
              >
                <RotateCw className='h-5 w-5' />
              </Button>
              <div className='w-px h-6 bg-white/20 mx-2' />
              <Button
                variant='ghost'
                size='icon'
                onClick={onClose}
                className='text-white hover:bg-white/10'
              >
                <X className='h-5 w-5' />
              </Button>
            </div>
          </div>
          <div className='flex-1 flex items-center justify-center overflow-auto p-4 relative'>
            {hasPrev && (
              <div
                className='absolute left-0 top-0 bottom-0 w-[30%] cursor-pointer z-10'
                onClick={goPrev}
              />
            )}
            {hasNext && (
              <div
                className='absolute right-0 top-0 bottom-0 w-[30%] cursor-pointer z-10'
                onClick={goNext}
              />
            )}
            <img
              src={mediaUrl}
              alt={fileName}
              className='transition-transform duration-200 pointer-events-none'
              style={{
                ...(zoom === 'fit'
                  ? { width: '100%', height: '100%', objectFit: 'contain' as const }
                  : {
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'none' as const,
                    }),
                transform: `scale(${zoom === 'fit' ? 1 : zoom / 100}) rotate(${rotation}deg)`,
              }}
            />
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

function InlinePdfViewer({
  fileName,
  mediaUrl,
  onClose,
}: {
  fileName: string
  mediaUrl: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay className='bg-black/95' />
        <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
          <span className='sr-only'>
            <DialogTitle>{fileName}</DialogTitle>
          </span>
          <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
            <h2 className='text-white text-lg font-medium truncate flex-1'>{fileName}</h2>
            <div className='flex items-center gap-2'>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => window.open(mediaUrl, '_blank')}
                className='text-white hover:bg-white/10'
              >
                <ExternalLink className='h-5 w-5' />
              </Button>
              <div className='w-px h-6 bg-white/20 mx-2' />
              <Button
                variant='ghost'
                size='icon'
                onClick={onClose}
                className='text-white hover:bg-white/10'
              >
                <X className='h-5 w-5' />
              </Button>
            </div>
          </div>
          <div className='flex-1 overflow-hidden bg-neutral-800'>
            <embed
              src={`${mediaUrl}#toolbar=1`}
              type='application/pdf'
              className='w-full h-full'
              title={fileName}
            />
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

// Simple media player for audio/video within shared folders
function ShareMediaPlayer({
  filePath,
  files,
  getMediaUrl,
  onNavigate,
  onClose,
}: {
  filePath: string
  files: FileItem[]
  getMediaUrl: (path: string) => string
  onNavigate: (file: FileItem) => void
  onClose: () => void
}) {
  const fileName = filePath.split(/[/\\]/).pop() || ''
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const type = getMediaType(ext)
  const mediaUrl = getMediaUrl(filePath)

  const mediaFiles = useMemo(
    () =>
      files.filter((f) => {
        if (f.isDirectory) return false
        const t = getMediaType(f.extension)
        return type === 'audio' ? t === 'audio' : t === 'video'
      }),
    [files, type],
  )

  const currentIndex = mediaFiles.findIndex((f) => f.path === filePath)

  const playNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < mediaFiles.length - 1) {
      onNavigate(mediaFiles[currentIndex + 1])
    } else {
      onClose()
    }
  }, [currentIndex, mediaFiles, onNavigate, onClose])

  if (type === 'video') {
    return (
      <div className='w-full bg-background'>
        <Card className='py-0 w-full rounded-none border-x-0 border-t-0'>
          <div className='bg-black'>
            <div className='bg-background/90 backdrop-blur-sm border-b border-border p-2 flex items-center justify-between'>
              <span className='text-sm font-medium truncate flex-1 px-2'>{fileName}</span>
              {mediaFiles.length > 1 && (
                <span className='text-sm text-muted-foreground px-2'>
                  {currentIndex + 1} of {mediaFiles.length}
                </span>
              )}
              <Button variant='ghost' size='icon' onClick={onClose} className='h-8 w-8'>
                <X className='h-4 w-4' />
              </Button>
            </div>
            <video
              controls
              autoPlay
              className='w-full bg-black'
              style={{ maxHeight: '70vh', aspectRatio: '16 / 9' }}
              src={mediaUrl}
              onEnded={playNext}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </Card>
      </div>
    )
  }

  // Audio
  return (
    <div className='fixed bottom-0 left-0 right-0 z-40 bg-background border-t p-3'>
      <div className='container mx-auto flex items-center gap-4'>
        <span className='text-sm font-medium truncate flex-1'>{fileName}</span>
        {mediaFiles.length > 1 && (
          <span className='text-sm text-muted-foreground shrink-0'>
            {currentIndex + 1} of {mediaFiles.length}
          </span>
        )}
        <audio controls autoPlay className='flex-1 max-w-lg' src={mediaUrl} onEnded={playNext}>
          Your browser does not support the audio tag.
        </audio>
        <Button variant='ghost' size='icon' onClick={onClose} className='h-8 w-8'>
          <X className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}
