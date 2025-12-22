'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import {
  Folder,
  Music,
  Video,
  ChevronRight,
  Home,
  ArrowUp,
  List,
  LayoutGrid,
  Play,
  Image as ImageIcon,
  FileQuestion,
  FileText,
  Star,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface FileListProps {
  files: FileItem[]
  currentPath: string
  initialViewMode: 'list' | 'grid'
  initialFavorites?: string[]
}

type ViewMode = 'list' | 'grid'

// Save view mode to server
async function saveViewMode(folderPath: string, mode: ViewMode) {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, viewMode: mode }),
    })
  } catch (error) {
    console.error('Failed to save view mode:', error)
  }
}

// Toggle favorite status
async function toggleFavorite(filePath: string) {
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleFavorite', filePath }),
    })
    const data = await response.json()
    return data
  } catch (error) {
    console.error('Failed to toggle favorite:', error)
    return null
  }
}

function FileListInner({
  files,
  currentPath,
  initialViewMode,
  initialFavorites = [],
}: FileListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Use the server-provided initial view mode
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [favorites, setFavorites] = useState<string[]>(initialFavorites)

  // Handle view mode change and save to server
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    saveViewMode(currentPath, mode)
  }

  // Handle favorite toggle
  const handleFavoriteToggle = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent file click
    const result = await toggleFavorite(filePath)
    if (result && result.favorites) {
      setFavorites(result.favorites)
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

      router.push(`/?${params.toString()}`, { scroll: false })
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

  // Build breadcrumb path
  const pathParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
  const breadcrumbs = [
    { name: 'Home', path: '' },
    ...pathParts.map((part, index) => ({
      name: part,
      path: pathParts.slice(0, index + 1).join('/'),
    })),
  ]

  const playingPath = searchParams.get('playing')

  // Handle navigation to parent directory
  const handleParentDirectory = () => {
    const params = new URLSearchParams(searchParams)
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

  return (
    <div className='flex flex-col'>
      {/* Breadcrumb Navigation */}
      <div className='p-2 lg:p-4 border-b border-border bg-muted/30 shrink-0'>
        <div className='flex items-center justify-between gap-2 lg:gap-4'>
          <div className='flex items-center gap-1 lg:gap-2 flex-wrap'>
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.path} className='flex items-center gap-2'>
                {index > 0 && <ChevronRight className='h-4 w-4 text-muted-foreground' />}
                <Button
                  variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
                  size='sm'
                  onClick={() => handleBreadcrumbClick(crumb.path)}
                  className='gap-2'
                >
                  {index === 0 && <Home className='h-4 w-4' />}
                  {crumb.name}
                </Button>
              </div>
            ))}
          </div>
          <div className='flex gap-1'>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleViewModeChange('list')}
            >
              <List className='h-4 w-4' />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleViewModeChange('grid')}
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
                      className={`cursor-pointer hover:bg-muted/50 select-none ${
                        playingPath === file.path ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => handleFileClick(file)}
                    >
                      <TableCell className='w-12'>
                        {getIcon(
                          file.type,
                          playingPath === file.path,
                          file.type === MediaType.AUDIO,
                        )}
                      </TableCell>
                      <TableCell className='font-medium'>
                        <div className='flex items-center gap-2 group'>
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
