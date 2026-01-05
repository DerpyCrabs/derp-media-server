'use client'

import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { isPathEditable } from '@/lib/utils'
import { ArrowUp, Star, Eye } from 'lucide-react'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { FileContextMenu } from '@/components/file-context-menu'
import { VIRTUAL_FOLDERS } from '@/lib/constants'

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
  getViewCount: (path: string) => number
  getIcon: (
    type: MediaType,
    filePath: string,
    isAudioFile?: boolean,
    isVideoFile?: boolean,
    isVirtual?: boolean,
  ) => React.ReactElement
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
  getViewCount,
  getIcon,
}: FileListViewProps) {
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

  return (
    <div className='sm:px-4 py-2'>
      <Table>
        <TableBody>
          {/* Parent directory entry - only show when not at root */}
          {currentPath && (
            <TableRow
              className='cursor-pointer hover:bg-muted/50 select-none'
              onClick={onParentDirectory}
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
                onSetIcon={onContextSetIcon}
                onRename={onContextRename}
                onDelete={onContextDelete}
                onDownload={onContextDownload}
                onToggleFavorite={onContextToggleFavorite}
                isFavorite={isFavorite}
                isEditable={isFileEditable}
              >
                <TableRow
                  className={`cursor-pointer hover:bg-muted/50 select-none group ${
                    playingPath === file.path ? 'bg-primary/10' : ''
                  }`}
                  onClick={() => onFileClick(file)}
                  onMouseEnter={() => file.isDirectory && onFolderHover(file.path)}
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
                        <span className='truncate block'>{file.name}</span>
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
  )
}
