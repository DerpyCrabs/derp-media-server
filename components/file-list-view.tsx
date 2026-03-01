'use client'

import { useState, useRef, useEffect } from 'react'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { isPathEditable } from '@/lib/utils'
import { ArrowUp, Star, Eye, Link, Share2, FilePlus, FolderPlus, AlertCircle } from 'lucide-react'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { FileContextMenu } from '@/components/file-context-menu'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'

interface FileListViewProps {
  files: FileItem[]
  currentPath: string
  favorites: string[]
  playingPath: string | null
  isVirtualFolder: boolean
  editableFolders: string[]
  onFileClick: (file: FileItem) => void
  onFolderHover: (path: string) => void
  onParentDirectory: () => void
  onFavoriteToggle: (path: string, e: React.MouseEvent) => void
  onContextSetIcon: (file: FileItem) => void
  onContextRename: (file: FileItem) => void
  onContextDelete: (file: FileItem) => void
  onContextDownload: (file: FileItem) => void
  onContextToggleFavorite: (file: FileItem) => void
  onContextToggleKnowledgeBase?: (file: FileItem) => void
  onContextShare: (file: FileItem) => void
  onContextCopyShareLink?: (file: FileItem) => void
  onContextMove?: (file: FileItem) => void
  onContextCopy?: (file: FileItem) => void
  hasEditableFolders?: boolean
  onMoveFile?: (sourcePath: string, destinationDir: string) => void
  shares: ShareLink[]
  knowledgeBases?: string[]
  getViewCount: (path: string) => number
  getShareViewCount: (path: string) => number
  getIcon: (
    type: MediaType,
    filePath: string,
    isAudioFile?: boolean,
    isVideoFile?: boolean,
    isVirtual?: boolean,
  ) => React.ReactElement
  /** When true, show inline New file / New folder row at bottom (KB + editable) */
  showInlineCreate?: boolean
  onInlineCreateFile?: (name: string) => void
  onInlineCreateFolder?: (name: string) => void
  createFilePending?: boolean
  createFolderPending?: boolean
  createFileError?: Error | null
  createFolderError?: Error | null
  onInlineCreateCancel?: () => void
}

export function FileListView({
  files,
  currentPath,
  favorites,
  playingPath,
  isVirtualFolder,
  editableFolders,
  onFileClick,
  onFolderHover,
  onParentDirectory,
  onFavoriteToggle,
  onContextSetIcon,
  onContextRename,
  onContextDelete,
  onContextDownload,
  onContextToggleFavorite,
  onContextToggleKnowledgeBase,
  onContextShare,
  onContextCopyShareLink,
  onContextMove,
  onContextCopy,
  hasEditableFolders = false,
  onMoveFile,
  shares,
  knowledgeBases = [],
  getViewCount,
  getShareViewCount,
  getIcon,
  showInlineCreate = false,
  onInlineCreateFile,
  onInlineCreateFolder,
  createFilePending = false,
  createFolderPending = false,
  createFileError = null,
  createFolderError = null,
  onInlineCreateCancel,
}: FileListViewProps) {
  const [inlineMode, setInlineMode] = useState<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const enableDrag = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

  const parentParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
  const parentDir = parentParts.slice(0, -1).join('/')
  const canDropOnParent =
    !!onMoveFile && !!currentPath && isPathEditable(parentDir || '', editableFolders)

  const canDropOn = (targetPath: string) => {
    if (!draggedPath || draggedPath === targetPath) return false
    if (targetPath.startsWith(draggedPath + '/')) return false
    return true
  }

  useEffect(() => {
    if (inlineMode === 'file') fileInputRef.current?.focus()
    else if (inlineMode === 'folder') folderInputRef.current?.focus()
  }, [inlineMode])

  const inlineFolderExists =
    inlineMode === 'folder' &&
    !!inlineName.trim() &&
    files.some((f) => f.isDirectory && f.name.toLowerCase() === inlineName.trim().toLowerCase())
  const inlineFileExists =
    inlineMode === 'file' &&
    !!inlineName.trim() &&
    files.some((f) => {
      const fileName = inlineName.includes('.') ? inlineName.trim() : `${inlineName.trim()}.txt`
      return !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase()
    })

  const handleInlineCreateFile = () => {
    const name = inlineName.trim()
    if (!name || inlineFileExists || !onInlineCreateFile) return
    onInlineCreateFile(name)
    setInlineMode(null)
    setInlineName('')
  }
  const handleInlineCreateFolder = () => {
    const name = inlineName.trim()
    if (!name || inlineFolderExists || !onInlineCreateFolder) return
    onInlineCreateFolder(name)
    setInlineMode(null)
    setInlineName('')
  }
  if (files.length === 0 && !currentPath) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <div className='h-12 w-12 mx-auto mb-4 opacity-50'>
          {getIcon(MediaType.FOLDER, '', false, false, false)}
        </div>
        <p>No media files found in this directory</p>
      </div>
    )
  }

  if (files.length === 0 && currentPath === VIRTUAL_FOLDERS.MOST_PLAYED) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <Eye className='h-12 w-12 mx-auto mb-4 opacity-50' />
        <p>No played files yet</p>
        <p className='text-xs mt-2'>Files you play will appear here</p>
      </div>
    )
  }

  if (files.length === 0 && currentPath === VIRTUAL_FOLDERS.FAVORITES) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <Star className='h-12 w-12 mx-auto mb-4 opacity-50' />
        <p>No favorites yet</p>
        <p className='text-xs mt-2'>Star files to add them to your favorites</p>
      </div>
    )
  }

  if (files.length === 0 && currentPath === VIRTUAL_FOLDERS.SHARES) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <Link className='h-12 w-12 mx-auto mb-4 opacity-50' />
        <p>No active shares</p>
        <p className='text-xs mt-2'>
          Right-click a file or folder and select Share to create a link
        </p>
      </div>
    )
  }

  return (
    <div className='sm:px-4 py-2'>
      <Table>
        <TableBody>
          {/* Parent directory entry - only show when not at root */}
          {currentPath && (
            <TableRow
              className={`cursor-pointer hover:bg-muted/50 select-none ${
                dragOverPath === '__parent__' ? 'bg-primary/20' : ''
              }`}
              onClick={onParentDirectory}
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
                if (draggedPath && onMoveFile) {
                  onMoveFile(draggedPath, parentDir)
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
            const isFavorite = favorites.includes(file.path)
            const isKnowledgeBase = file.isDirectory && knowledgeBases.includes(file.path)
            const viewCount = getViewCount(file.path)
            const shareViewCount = getShareViewCount(file.path)
            const isFileEditable = isPathEditable(file.path, editableFolders)
            const isShared = shares.some((s) => s.path === file.path)
            return (
              <FileContextMenu
                key={file.shareToken ? `share-${file.shareToken}` : file.path}
                file={file}
                onSetIcon={onContextSetIcon}
                onRename={onContextRename}
                onDelete={onContextDelete}
                onDownload={onContextDownload}
                onToggleFavorite={onContextToggleFavorite}
                onToggleKnowledgeBase={onContextToggleKnowledgeBase}
                onShare={onContextShare}
                onCopyShareLink={onContextCopyShareLink}
                onMove={onContextMove}
                onCopy={onContextCopy}
                hasEditableFolders={hasEditableFolders}
                isFavorite={isFavorite}
                isKnowledgeBase={isKnowledgeBase}
                isEditable={isFileEditable}
                isShared={isShared}
              >
                <TableRow
                  className={`cursor-pointer hover:bg-muted/50 select-none group ${
                    playingPath === file.path ? 'bg-primary/10' : ''
                  } ${draggedPath === file.path ? 'opacity-50' : ''} ${
                    file.isDirectory && dragOverPath === file.path ? 'bg-primary/20' : ''
                  }`}
                  draggable={isFileEditable && !!onMoveFile && enableDrag}
                  onClick={() => onFileClick(file)}
                  onMouseEnter={() => file.isDirectory && onFolderHover(file.path)}
                  onDragStart={(e) => {
                    if (!isFileEditable || !onMoveFile) return
                    e.dataTransfer.setData('text/plain', file.path)
                    e.dataTransfer.effectAllowed = 'move'
                    setDraggedPath(file.path)
                  }}
                  onDragEnd={() => {
                    setDraggedPath(null)
                    setDragOverPath(null)
                  }}
                  onDragOver={(e) => {
                    if (!file.isDirectory || !onMoveFile || !draggedPath) return
                    if (!canDropOn(file.path)) return
                    if (!isPathEditable(file.path, editableFolders)) return
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
                    if (draggedPath && file.isDirectory && onMoveFile && canDropOn(file.path)) {
                      onMoveFile(draggedPath, file.path)
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
                    <div className='flex items-center gap-2'>
                      {!file.isDirectory && (
                        <button
                          onClick={(e) => onFavoriteToggle(file.path, e)}
                          className='shrink-0 opacity-50 hover:opacity-100 transition-opacity'
                          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          suppressHydrationWarning
                        >
                          <Star
                            className={`h-4 w-4 ${
                              isFavorite
                                ? 'fill-yellow-400 text-yellow-400 opacity-100'
                                : 'text-muted-foreground'
                            }`}
                            suppressHydrationWarning
                          />
                        </button>
                      )}
                      <div className='flex-1 min-w-0'>
                        <span className='truncate block'>
                          {file.name}
                          {isShared && (
                            <Link className='inline h-3 w-3 ml-1.5 text-primary opacity-70' />
                          )}
                        </span>
                        {isVirtualFolder && !file.isDirectory && (
                          <span className='text-xs text-muted-foreground truncate block'>
                            {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className='w-32 text-right text-muted-foreground'>
                    <div className='flex items-center justify-end gap-2'>
                      {!file.isDirectory && viewCount > 0 && (
                        <div
                          className='flex items-center gap-1 text-xs'
                          title={`${viewCount} views`}
                          suppressHydrationWarning
                        >
                          <Eye className='h-3.5 w-3.5' />
                          <span suppressHydrationWarning>{viewCount}</span>
                        </div>
                      )}
                      {!file.isDirectory && shareViewCount > 0 && (
                        <div
                          className='flex items-center gap-1 text-xs text-primary/70'
                          title={`${shareViewCount} shared views`}
                          suppressHydrationWarning
                        >
                          <Share2 className='h-3 w-3' />
                          <span suppressHydrationWarning>{shareViewCount}</span>
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
          {showInlineCreate && (
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
                          placeholder='File name (e.g. notes.txt)'
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleInlineCreateFile()
                            else if (e.key === 'Escape') {
                              setInlineMode(null)
                              setInlineName('')
                            }
                          }}
                          onBlur={() => {
                            setInlineMode(null)
                            setInlineName('')
                            onInlineCreateCancel?.()
                          }}
                          disabled={createFilePending}
                          className={`h-8 text-sm ${
                            inlineFileExists
                              ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                              : createFileError
                                ? 'border-destructive ring-2 ring-destructive/30'
                                : ''
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {inlineFileExists && (
                          <div className='flex items-start gap-1.5 rounded bg-yellow-500/10 border border-yellow-500/50 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>A file with this name already exists.</span>
                          </div>
                        )}
                        {createFileError && !inlineFileExists && (
                          <div className='flex items-start gap-1.5 rounded bg-destructive/10 border border-destructive/50 px-2 py-1.5 text-xs text-destructive'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>{createFileError.message}</span>
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
                            if (e.key === 'Enter') handleInlineCreateFolder()
                            else if (e.key === 'Escape') {
                              setInlineMode(null)
                              setInlineName('')
                            }
                          }}
                          onBlur={() => {
                            setInlineMode(null)
                            setInlineName('')
                            onInlineCreateCancel?.()
                          }}
                          disabled={createFolderPending}
                          className={`h-8 text-sm ${
                            inlineFolderExists
                              ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                              : createFolderError
                                ? 'border-destructive ring-2 ring-destructive/30'
                                : ''
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {inlineFolderExists && (
                          <div className='flex items-start gap-1.5 rounded bg-yellow-500/10 border border-yellow-500/50 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>A folder with this name already exists.</span>
                          </div>
                        )}
                        {createFolderError && !inlineFolderExists && (
                          <div className='flex items-start gap-1.5 rounded bg-destructive/10 border border-destructive/50 px-2 py-1.5 text-xs text-destructive'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>{createFolderError.message}</span>
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
  )
}
