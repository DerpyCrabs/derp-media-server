import React, { memo, useCallback, type DragEvent, type MouseEvent } from 'react'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { isPathEditable } from '@/lib/utils'
import { ArrowUp, Star, Eye, Link, Share2, Download } from 'lucide-react'
import { TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { FileContextMenu } from '@/components/file-context-menu'
import {
  setFileDragData,
  hasFileDragData,
  getFileDragData,
  isCompatibleSource,
} from '@/lib/file-drag-data'

export interface FileListFileRowProps {
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
  showDownloadButton: boolean
  onFavoriteToggle?: (path: string, e: MouseEvent) => void
  onContextDownload?: (file: FileItem) => void
  isVirtualFolder: boolean
  hasAnyContextAction: boolean
  onContextSetIcon?: (file: FileItem) => void
  onContextRename?: (file: FileItem) => void
  onContextDelete?: (file: FileItem) => void
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

export const FileListFileRow = memo(function FileListFileRow({
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
  showDownloadButton,
  onFavoriteToggle,
  onContextDownload,
  isVirtualFolder,
  hasAnyContextAction,
  onContextSetIcon,
  onContextRename,
  onContextDelete,
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
}: FileListFileRowProps) {
  const handleClick = useCallback(() => {
    onFileClick(file)
  }, [onFileClick, file])

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

  const handleDownloadClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      onContextDownload?.(file)
    },
    [onContextDownload, file],
  )

  const row = (
    <TableRow
      className={`cursor-pointer hover:bg-muted/50 select-none group ${
        playingPath === file.path ? 'bg-primary/10' : ''
      } ${draggedPath === file.path ? 'opacity-50' : ''} ${
        file.isDirectory && dragOverPath === file.path ? 'bg-primary/20' : ''
      }`}
      draggable={enableDrag && isFileEditable && !!onMoveFile}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
          {showFavorites && !file.isDirectory && (
            <button
              onClick={handleFavoriteClick}
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
              {isShared && <Link className='inline h-3 w-3 ml-1.5 text-primary opacity-70' />}
            </span>
            {isVirtualFolder && !file.isDirectory && (
              <span className='text-xs text-muted-foreground truncate block'>
                {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className='text-right text-muted-foreground'>
        <div className='flex items-center justify-end gap-2'>
          {showViewCounts && !file.isDirectory && (
            <div
              className={`flex items-center gap-1 text-xs ${viewCount > 0 ? '' : 'hidden'}`}
              title={`${viewCount} views`}
              suppressHydrationWarning
            >
              <Eye className='h-3.5 w-3.5 shrink-0' />
              <span suppressHydrationWarning>{viewCount}</span>
            </div>
          )}
          {showViewCounts && !file.isDirectory && (
            <div
              className={`flex items-center gap-1 text-xs text-primary/70 ${shareViewCount > 0 ? '' : 'hidden'}`}
              title={`${shareViewCount} shared views`}
              suppressHydrationWarning
            >
              <Share2 className='h-3 w-3 shrink-0' />
              <span suppressHydrationWarning>{shareViewCount}</span>
            </div>
          )}
          {showDownloadButton && onContextDownload && (
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={handleDownloadClick}
              title='Download'
            >
              <Download className='h-3.5 w-3.5' />
            </Button>
          )}
          <span className='w-20 text-right shrink-0'>
            {file.isDirectory ? '' : formatFileSize(file.size)}
          </span>
        </div>
      </TableCell>
    </TableRow>
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
      {row}
    </FileContextMenu>
  ) : (
    <React.Fragment key={file.path}>{row}</React.Fragment>
  )
})

export interface FileListParentDirectoryRowProps {
  dragOverPath: string | null
  canDropOnParent: boolean
  draggedPath: string | null
  parentDir: string
  onMoveFile?: (sourcePath: string, destinationDir: string) => void
  dragSourceKind?: 'local' | 'share'
  dragSourceToken?: string | undefined
  canDropOn: (targetPath: string, sourcePath?: string) => boolean
  onParentDirectory: () => void
  setDragOverPath: React.Dispatch<React.SetStateAction<string | null>>
}

export const FileListParentDirectoryRow = memo(function FileListParentDirectoryRow({
  dragOverPath,
  canDropOnParent,
  draggedPath,
  parentDir,
  onMoveFile,
  dragSourceKind,
  dragSourceToken,
  canDropOn,
  onParentDirectory,
  setDragOverPath,
}: FileListParentDirectoryRowProps) {
  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!canDropOnParent) return
      if (!draggedPath && !hasFileDragData(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverPath('__parent__')
    },
    [canDropOnParent, draggedPath, setDragOverPath],
  )

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDragOverPath(null)
      }
    },
    [setDragOverPath],
  )

  const handleDrop = useCallback(
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
    [
      setDragOverPath,
      draggedPath,
      onMoveFile,
      parentDir,
      dragSourceKind,
      dragSourceToken,
      canDropOn,
    ],
  )

  return (
    <TableRow
      className={`cursor-pointer hover:bg-muted/50 select-none ${
        dragOverPath === '__parent__' ? 'bg-primary/20' : ''
      }`}
      onClick={onParentDirectory}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <TableCell className='w-12'>
        <ArrowUp className='h-5 w-5 text-muted-foreground' />
      </TableCell>
      <TableCell className='font-medium'>..</TableCell>
      <TableCell className='text-right text-muted-foreground'></TableCell>
    </TableRow>
  )
})
