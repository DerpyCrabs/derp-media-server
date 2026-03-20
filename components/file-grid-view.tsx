import React, {
  memo,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type DragEvent,
  type MouseEvent,
  type SyntheticEvent,
} from 'react'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { isPathEditable } from '@/lib/utils'
import { ArrowUp, Star, Eye, Link, Share2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FileContextMenu } from '@/components/file-context-menu'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'
import {
  setFileDragData,
  hasFileDragData,
  getFileDragData,
  isCompatibleSource,
} from '@/lib/file-drag-data'

const DEFAULT_GRID_EDITABLE_FOLDERS: string[] = []
const DEFAULT_GRID_SHARES: ShareLink[] = []

interface FileGridFileCardProps {
  file: FileItem
  playingPath: string | null
  draggedPath: string | null
  dragOverPath: string | null
  enableDrag: boolean
  isFileEditable: boolean
  onMoveFile?: (sourcePath: string, destinationDir: string) => void
  dragSourceKind?: 'local' | 'share'
  dragSourceToken?: string | undefined
  onFileClick: (file: FileItem) => void
  getIcon: (
    type: MediaType,
    filePath: string,
    isAudioFile?: boolean,
    isVideoFile?: boolean,
    isVirtual?: boolean,
  ) => React.ReactElement
  editableFolders: string[]
  isEditableProp: boolean | undefined
  canDropOn: (targetPath: string, sourcePath?: string) => boolean
  setDraggedPath: React.Dispatch<React.SetStateAction<string | null>>
  setDragOverPath: React.Dispatch<React.SetStateAction<string | null>>
  isFavorite: boolean
  isKnowledgeBase: boolean
  viewCount: number
  shareViewCount: number
  isShared: boolean
  showFavorites: boolean
  showViewCounts: boolean
  onFavoriteToggle?: (path: string, e: MouseEvent) => void
  isVirtualFolder: boolean
  hasAnyContextAction: boolean
  resolveThumbnailUrl: (file: FileItem) => string
  resolveImagePreviewUrl: (file: FileItem) => string
  onContextSetIcon?: (file: FileItem) => void
  onContextRename?: (file: FileItem) => void
  onContextDelete?: (file: FileItem) => void
  onContextDownload?: (file: FileItem) => void
  onContextToggleFavorite?: (file: FileItem) => void
  onContextToggleKnowledgeBase?: (file: FileItem) => void
  onContextShare?: (file: FileItem) => void
  onContextCopyShareLink?: (file: FileItem) => void
  onContextMove?: (file: FileItem) => void
  onContextCopy?: (file: FileItem) => void
  onContextOpenInNewTab?: (file: FileItem) => void
  onContextOpenInWorkspace?: (file: FileItem) => void
  onContextAddToTaskbar?: (file: FileItem) => void
  showOpenInNewTabForFiles?: boolean
  contextOpenWorkspaceAsStandalone?: boolean
  hasEditableFolders?: boolean
}

const FileGridFileCard = memo(function FileGridFileCard({
  file,
  playingPath,
  draggedPath,
  dragOverPath,
  enableDrag,
  isFileEditable,
  onMoveFile,
  dragSourceKind,
  dragSourceToken,
  onFileClick,
  getIcon,
  editableFolders,
  isEditableProp,
  canDropOn,
  setDraggedPath,
  setDragOverPath,
  isFavorite,
  isKnowledgeBase,
  viewCount,
  shareViewCount,
  isShared,
  showFavorites,
  showViewCounts,
  onFavoriteToggle,
  isVirtualFolder,
  hasAnyContextAction,
  resolveThumbnailUrl,
  resolveImagePreviewUrl,
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
  onContextOpenInNewTab,
  onContextOpenInWorkspace,
  onContextAddToTaskbar,
  showOpenInNewTabForFiles,
  contextOpenWorkspaceAsStandalone,
  hasEditableFolders,
}: FileGridFileCardProps) {
  const handleClick = useCallback(() => onFileClick(file), [onFileClick, file])

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      if (!isFileEditable || !onMoveFile) return
      if (dragSourceKind) {
        setFileDragData(e.dataTransfer, {
          path: file.path,
          isDirectory: file.isDirectory,
          sourceKind: dragSourceKind,
          sourceToken: dragSourceToken,
        })
      } else {
        e.dataTransfer.setData('text/plain', file.path)
      }
      e.dataTransfer.effectAllowed = 'copyMove'
      setDraggedPath(file.path)
    },
    [
      isFileEditable,
      onMoveFile,
      dragSourceKind,
      dragSourceToken,
      file.path,
      file.isDirectory,
      setDraggedPath,
    ],
  )

  const handleDragEnd = useCallback(() => {
    setDraggedPath(null)
    setDragOverPath(null)
  }, [setDraggedPath, setDragOverPath])

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!file.isDirectory || !onMoveFile) return
      const hasCrossDrag = !draggedPath && hasFileDragData(e.dataTransfer)
      if (!draggedPath && !hasCrossDrag) return
      if (draggedPath && !canDropOn(file.path)) return
      if (isEditableProp === undefined && !isPathEditable(file.path, editableFolders)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverPath(file.path)
    },
    [
      file.isDirectory,
      file.path,
      onMoveFile,
      draggedPath,
      canDropOn,
      isEditableProp,
      editableFolders,
      setDragOverPath,
    ],
  )

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        if (dragOverPath === file.path) setDragOverPath(null)
      }
    },
    [dragOverPath, file.path, setDragOverPath],
  )

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOverPath(null)
      if (draggedPath && file.isDirectory && onMoveFile && canDropOn(file.path)) {
        onMoveFile(draggedPath, file.path)
      } else if (!draggedPath && file.isDirectory && onMoveFile) {
        const data = getFileDragData(e.dataTransfer)
        if (
          data &&
          dragSourceKind &&
          isCompatibleSource({ sourceKind: dragSourceKind, sourceToken: dragSourceToken }, data) &&
          canDropOn(file.path, data.path)
        ) {
          onMoveFile(data.path, file.path)
        }
      }
    },
    [
      setDragOverPath,
      draggedPath,
      file.isDirectory,
      file.path,
      onMoveFile,
      canDropOn,
      dragSourceKind,
      dragSourceToken,
    ],
  )

  const handleFavoriteClick = useCallback(
    (e: MouseEvent) => {
      onFavoriteToggle?.(file.path, e)
    },
    [onFavoriteToggle, file.path],
  )

  const handleImgError = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none'
    const parent = e.currentTarget.parentElement
    if (parent) {
      const icon = parent.querySelector('.fallback-icon')
      if (icon) {
        icon.classList.remove('hidden')
      }
    }
  }, [])

  const card = (
    <Card
      className={`cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 ${
        playingPath === file.path ? 'ring-2 ring-primary' : ''
      } ${draggedPath === file.path ? 'opacity-50' : ''} ${
        file.isDirectory && dragOverPath === file.path ? 'ring-2 ring-primary bg-primary/10' : ''
      }`}
      draggable={enableDrag && isFileEditable && !!onMoveFile}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CardContent className='flex h-full flex-col p-0'>
        <div className='group relative flex aspect-video items-center justify-center overflow-hidden rounded-t-lg bg-muted'>
          {showFavorites && !file.isDirectory && (
            <button
              onClick={handleFavoriteClick}
              className={`absolute top-1.5 left-1.5 z-10 rounded-full p-1 transition-all ${
                isFavorite
                  ? 'bg-background/90 shadow-sm hover:bg-background'
                  : 'bg-background/70 opacity-60 hover:bg-background/90 group-hover:opacity-100'
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
          {showViewCounts && !file.isDirectory && (
            <div
              className={`absolute top-1.5 right-1.5 z-10 flex items-center gap-1 ${viewCount > 0 || shareViewCount > 0 ? '' : 'hidden'}`}
              suppressHydrationWarning
            >
              <div
                className={`flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm ${viewCount > 0 ? '' : 'hidden'}`}
                title={`${viewCount} views`}
                suppressHydrationWarning
              >
                <Eye className='h-3 w-3 text-muted-foreground' />
                <span
                  className='text-xs font-medium text-muted-foreground'
                  suppressHydrationWarning
                >
                  {viewCount}
                </span>
              </div>
              <div
                className={`flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm ${shareViewCount > 0 ? '' : 'hidden'}`}
                title={`${shareViewCount} shared views`}
                suppressHydrationWarning
              >
                <Share2 className='h-3 w-3 text-primary/70' />
                <span className='text-xs font-medium text-primary/70' suppressHydrationWarning>
                  {shareViewCount}
                </span>
              </div>
            </div>
          )}
          {file.type === MediaType.VIDEO ? (
            <img
              src={resolveThumbnailUrl(file)}
              alt={file.name}
              loading='lazy'
              className='h-full w-full rounded-t-lg object-cover'
              onError={handleImgError}
            />
          ) : file.type === MediaType.IMAGE ? (
            <img
              src={resolveImagePreviewUrl(file)}
              alt={file.name}
              loading='lazy'
              className='h-full w-full rounded-t-lg object-cover'
              onError={handleImgError}
            />
          ) : null}
          <div
            className={`fallback-icon ${
              file.type === MediaType.VIDEO || file.type === MediaType.IMAGE ? 'hidden' : ''
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
        <div className='flex flex-col gap-1 p-3'>
          <p className='truncate text-sm font-medium' title={file.name}>
            {file.name}
            {isShared && <Link className='ml-1 inline h-3 w-3 text-primary opacity-70' />}
          </p>
          {isVirtualFolder && !file.isDirectory ? (
            <p
              className='truncate text-xs text-muted-foreground'
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
  )

  return hasAnyContextAction ? (
    <FileContextMenu
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
      onOpenInNewTab={onContextOpenInNewTab}
      onOpenInWorkspace={onContextOpenInWorkspace}
      onAddToTaskbar={onContextAddToTaskbar}
      showOpenInNewTabForFiles={showOpenInNewTabForFiles}
      contextOpenWorkspaceAsStandalone={contextOpenWorkspaceAsStandalone}
      hasEditableFolders={hasEditableFolders}
      isFavorite={isFavorite}
      isKnowledgeBase={isKnowledgeBase}
      isEditable={isFileEditable}
      isShared={isShared}
    >
      {card}
    </FileContextMenu>
  ) : (
    <React.Fragment key={file.path}>{card}</React.Fragment>
  )
})

interface FileGridViewProps {
  files: FileItem[]
  currentPath: string
  playingPath: string | null
  onFileClick: (file: FileItem) => void
  onParentDirectory: () => void
  getIcon: (
    type: MediaType,
    filePath: string,
    isAudioFile?: boolean,
    isVideoFile?: boolean,
    isVirtual?: boolean,
  ) => React.ReactElement

  favorites?: string[]
  isVirtualFolder?: boolean
  editableFolders?: string[]
  shares?: ShareLink[]
  knowledgeBases?: string[]
  getViewCount?: (path: string) => number
  getShareViewCount?: (path: string) => number

  onFavoriteToggle?: (path: string, e: React.MouseEvent) => void
  onContextSetIcon?: (file: FileItem) => void
  onContextRename?: (file: FileItem) => void
  onContextDelete?: (file: FileItem) => void
  onContextDownload?: (file: FileItem) => void
  onContextToggleFavorite?: (file: FileItem) => void
  onContextToggleKnowledgeBase?: (file: FileItem) => void
  onContextShare?: (file: FileItem) => void
  onContextCopyShareLink?: (file: FileItem) => void
  onContextMove?: (file: FileItem) => void
  onContextCopy?: (file: FileItem) => void
  onContextOpenInNewTab?: (file: FileItem) => void
  onContextOpenInWorkspace?: (file: FileItem) => void
  onContextAddToTaskbar?: (file: FileItem) => void
  showOpenInNewTabForFiles?: boolean
  contextOpenWorkspaceAsStandalone?: boolean
  hasEditableFolders?: boolean
  onMoveFile?: (sourcePath: string, destinationDir: string) => void

  isEditable?: boolean
  dragSourceKind?: 'local' | 'share'
  dragSourceToken?: string
  getThumbnailUrl?: (file: FileItem) => string
  getImagePreviewUrl?: (file: FileItem) => string
}

export function FileGridView({
  files,
  currentPath,
  playingPath,
  onFileClick,
  onParentDirectory,
  getIcon,
  favorites = [],
  isVirtualFolder = false,
  editableFolders = DEFAULT_GRID_EDITABLE_FOLDERS,
  shares = DEFAULT_GRID_SHARES,
  knowledgeBases = [],
  getViewCount,
  getShareViewCount,
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
  onContextOpenInNewTab,
  onContextOpenInWorkspace,
  onContextAddToTaskbar,
  showOpenInNewTabForFiles = false,
  contextOpenWorkspaceAsStandalone = false,
  hasEditableFolders = false,
  onMoveFile,
  isEditable: isEditableProp,
  dragSourceKind,
  dragSourceToken,
  getThumbnailUrl,
  getImagePreviewUrl,
}: FileGridViewProps) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [enableDrag, setEnableDrag] = useState(false)
  useEffect(() => {
    setEnableDrag(window.matchMedia('(hover: hover)').matches)
  }, [])

  const showFavorites = !!onFavoriteToggle
  const showViewCounts = !!getViewCount
  const showShareIndicators = shares.length > 0

  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const sharedPathSet = useMemo(
    () => (showShareIndicators ? new Set(shares.map((s) => s.path)) : new Set<string>()),
    [shares, showShareIndicators],
  )

  const resolveThumbnailUrl = useMemo(
    () =>
      getThumbnailUrl ?? ((file: FileItem) => `/api/thumbnail/${encodeURIComponent(file.path)}`),
    [getThumbnailUrl],
  )
  const resolveImagePreviewUrl = useMemo(
    () => getImagePreviewUrl ?? ((file: FileItem) => `/api/media/${encodeURIComponent(file.path)}`),
    [getImagePreviewUrl],
  )

  const parentParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
  const parentDir = parentParts.slice(0, -1).join('/')
  const canDropOnParent =
    !!onMoveFile && !!currentPath && isPathEditable(parentDir || '', editableFolders)

  const canDropOn = useCallback(
    (targetPath: string, sourcePath?: string) => {
      const src = sourcePath ?? draggedPath
      if (!src || src === targetPath) return false
      if (targetPath.startsWith(src + '/')) return false
      return true
    },
    [draggedPath],
  )

  const handleGridParentDragOver = useCallback(
    (e: DragEvent) => {
      if (!canDropOnParent) return
      if (!draggedPath && !hasFileDragData(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverPath('__parent__')
    },
    [canDropOnParent, draggedPath],
  )

  const handleGridParentDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null)
    }
  }, [])

  const handleGridParentDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOverPath(null)
      if (draggedPath && onMoveFile) {
        onMoveFile(draggedPath, parentDir)
      } else if (!draggedPath && onMoveFile) {
        const data = getFileDragData(e.dataTransfer)
        if (
          data &&
          dragSourceKind &&
          isCompatibleSource({ sourceKind: dragSourceKind, sourceToken: dragSourceToken }, data) &&
          canDropOn(parentDir, data.path)
        ) {
          onMoveFile(data.path, parentDir)
        }
      }
    },
    [draggedPath, onMoveFile, parentDir, dragSourceKind, dragSourceToken, canDropOn],
  )

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

  const hasAnyContextAction =
    onContextRename ||
    onContextDelete ||
    onContextDownload ||
    onContextMove ||
    onContextCopy ||
    onContextSetIcon ||
    onContextToggleFavorite ||
    onContextShare ||
    onContextOpenInNewTab ||
    onContextOpenInWorkspace ||
    onContextAddToTaskbar ||
    onContextToggleKnowledgeBase ||
    onContextCopyShareLink

  return (
    <div className='py-4 px-4'>
      <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
        {currentPath && (
          <Card
            className={`cursor-pointer transition-colors select-none hover:bg-muted/50 ${
              dragOverPath === '__parent__' ? 'ring-2 ring-primary bg-primary/10' : ''
            }`}
            onClick={onParentDirectory}
            onDragOver={handleGridParentDragOver}
            onDragLeave={handleGridParentDragLeave}
            onDrop={handleGridParentDrop}
          >
            <CardContent className='flex aspect-video flex-col items-center justify-center p-4'>
              <ArrowUp className='mb-2 h-12 w-12 text-muted-foreground' />
              <p className='text-center text-sm font-medium'>..</p>
              <p className='text-center text-xs text-muted-foreground'>Parent Folder</p>
            </CardContent>
          </Card>
        )}
        {files.map((file) => {
          const isFavorite = favoriteSet.has(file.path)
          const isKnowledgeBase = file.isDirectory && knowledgeBases.includes(file.path)
          const viewCount = getViewCount?.(file.path) ?? 0
          const shareViewCount = getShareViewCount?.(file.path) ?? 0
          const isFileEditable =
            isEditableProp !== undefined
              ? isEditableProp
              : isPathEditable(file.path, editableFolders)
          const isShared = sharedPathSet.has(file.path)

          return (
            <FileGridFileCard
              key={file.shareToken ? `share-${file.shareToken}` : file.path}
              file={file}
              playingPath={playingPath}
              draggedPath={draggedPath}
              dragOverPath={dragOverPath}
              enableDrag={enableDrag}
              isFileEditable={isFileEditable}
              onMoveFile={onMoveFile}
              dragSourceKind={dragSourceKind}
              dragSourceToken={dragSourceToken}
              onFileClick={onFileClick}
              getIcon={getIcon}
              editableFolders={editableFolders}
              isEditableProp={isEditableProp}
              canDropOn={canDropOn}
              setDraggedPath={setDraggedPath}
              setDragOverPath={setDragOverPath}
              isFavorite={isFavorite}
              isKnowledgeBase={isKnowledgeBase}
              viewCount={viewCount}
              shareViewCount={shareViewCount}
              isShared={isShared}
              showFavorites={showFavorites}
              showViewCounts={showViewCounts}
              onFavoriteToggle={onFavoriteToggle}
              isVirtualFolder={isVirtualFolder}
              hasAnyContextAction={!!hasAnyContextAction}
              resolveThumbnailUrl={resolveThumbnailUrl}
              resolveImagePreviewUrl={resolveImagePreviewUrl}
              onContextSetIcon={onContextSetIcon}
              onContextRename={onContextRename}
              onContextDelete={onContextDelete}
              onContextDownload={onContextDownload}
              onContextToggleFavorite={onContextToggleFavorite}
              onContextToggleKnowledgeBase={onContextToggleKnowledgeBase}
              onContextShare={onContextShare}
              onContextCopyShareLink={onContextCopyShareLink}
              onContextMove={onContextMove}
              onContextCopy={onContextCopy}
              onContextOpenInNewTab={onContextOpenInNewTab}
              onContextOpenInWorkspace={onContextOpenInWorkspace}
              onContextAddToTaskbar={onContextAddToTaskbar}
              showOpenInNewTabForFiles={showOpenInNewTabForFiles}
              contextOpenWorkspaceAsStandalone={contextOpenWorkspaceAsStandalone}
              hasEditableFolders={hasEditableFolders}
            />
          )
        })}
      </div>
    </div>
  )
}
