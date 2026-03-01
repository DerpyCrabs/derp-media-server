'use client'

import { useState } from 'react'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { isPathEditable } from '@/lib/utils'
import { ArrowUp, Star, Eye, Link, Share2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FileContextMenu } from '@/components/file-context-menu'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'

interface FileGridViewProps {
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
}

export function FileGridView({
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
  onMoveFile,
  shares,
  knowledgeBases = [],
  getViewCount,
  getShareViewCount,
  getIcon,
}: FileGridViewProps) {
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
    <div className='py-4 px-4'>
      <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
        {/* Parent directory card - only show when not at root */}
        {currentPath && (
          <Card
            className={`cursor-pointer hover:bg-muted/50 transition-colors select-none ${
              dragOverPath === '__parent__' ? 'ring-2 ring-primary bg-primary/10' : ''
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
            <CardContent className='p-4 flex flex-col items-center justify-center aspect-video'>
              <ArrowUp className='h-12 w-12 text-muted-foreground mb-2' />
              <p className='text-sm font-medium text-center'>..</p>
              <p className='text-xs text-muted-foreground text-center'>Parent Folder</p>
            </CardContent>
          </Card>
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
              isFavorite={isFavorite}
              isKnowledgeBase={isKnowledgeBase}
              isEditable={isFileEditable}
              isShared={isShared}
            >
              <Card
                className={`cursor-pointer hover:bg-muted/50 transition-colors select-none py-0 ${
                  playingPath === file.path ? 'ring-2 ring-primary' : ''
                } ${draggedPath === file.path ? 'opacity-50' : ''} ${
                  file.isDirectory && dragOverPath === file.path
                    ? 'ring-2 ring-primary bg-primary/10'
                    : ''
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
                <CardContent className='p-0 flex flex-col h-full'>
                  {/* Thumbnail/Icon */}
                  <div className='relative aspect-video bg-muted flex items-center justify-center overflow-hidden rounded-t-lg group'>
                    {/* Favorite star overlay - only for files, not folders */}
                    {!file.isDirectory && (
                      <button
                        onClick={(e) => onFavoriteToggle(file.path, e)}
                        className={`absolute top-1.5 left-1.5 p-1 rounded-full transition-all z-10 ${
                          isFavorite
                            ? 'bg-background/90 hover:bg-background shadow-sm'
                            : 'bg-background/70 hover:bg-background/90 opacity-60 group-hover:opacity-100'
                        }`}
                        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star
                          className={`h-3.5 w-3.5 ${
                            isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'
                          }`}
                        />
                      </button>
                    )}
                    {/* View count badges */}
                    {!file.isDirectory && (viewCount > 0 || shareViewCount > 0) && (
                      <div className='absolute top-1.5 right-1.5 flex items-center gap-1 z-10'>
                        {viewCount > 0 && (
                          <div
                            className='px-2 py-0.5 rounded-full bg-background/90 backdrop-blur-sm shadow-sm flex items-center gap-1'
                            title={`${viewCount} views`}
                          >
                            <Eye className='h-3 w-3 text-muted-foreground' />
                            <span className='text-xs font-medium text-muted-foreground'>
                              {viewCount}
                            </span>
                          </div>
                        )}
                        {shareViewCount > 0 && (
                          <div
                            className='px-2 py-0.5 rounded-full bg-background/90 backdrop-blur-sm shadow-sm flex items-center gap-1'
                            title={`${shareViewCount} shared views`}
                          >
                            <Share2 className='h-3 w-3 text-primary/70' />
                            <span className='text-xs font-medium text-primary/70'>
                              {shareViewCount}
                            </span>
                          </div>
                        )}
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
                          file.isVirtual,
                        )}
                      </div>
                    </div>
                  </div>
                  {/* File Info */}
                  <div className='p-3 flex flex-col gap-1'>
                    <p className='text-sm font-medium truncate' title={file.name}>
                      {file.name}
                      {isShared && <Link className='inline h-3 w-3 ml-1 text-primary opacity-70' />}
                    </p>
                    {isVirtualFolder && !file.isDirectory ? (
                      <p
                        className='text-xs text-muted-foreground truncate'
                        title={file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
                      >
                        {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
                      </p>
                    ) : (
                      <div className='flex items-center justify-end text-xs text-muted-foreground'>
                        <span>{file.isDirectory ? '' : formatFileSize(file.size)}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </FileContextMenu>
          )
        })}
      </div>
    </div>
  )
}
