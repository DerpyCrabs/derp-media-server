'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileItem, MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { Folder, Music, Video, ChevronRight, Home } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface FileListProps {
  files: FileItem[]
  currentPath: string
}

function FileListInner({ files, currentPath }: FileListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleFileClick = (file: FileItem) => {
    const params = new URLSearchParams(searchParams)

    if (file.isDirectory) {
      // Navigate to folder
      params.set('dir', file.path)
      params.delete('playing') // Don't carry over playing state when changing folders
    } else {
      // Play media file
      params.set('playing', file.path)
      params.set('dir', currentPath)
    }

    router.push(`/?${params.toString()}`)
  }

  const handleBreadcrumbClick = (path: string) => {
    const params = new URLSearchParams(searchParams)
    if (path) {
      params.set('dir', path)
    } else {
      params.delete('dir')
    }
    params.delete('playing')
    router.push(`/?${params.toString()}`)
  }

  const getIcon = (type: MediaType) => {
    switch (type) {
      case MediaType.FOLDER:
        return <Folder className='h-5 w-5 text-blue-500' />
      case MediaType.AUDIO:
        return <Music className='h-5 w-5 text-purple-500' />
      case MediaType.VIDEO:
        return <Video className='h-5 w-5 text-red-500' />
      default:
        return null
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

  return (
    <div className='flex flex-col h-full min-h-0'>
      {/* Breadcrumb Navigation */}
      <div className='p-4 border-b border-border bg-muted/30 shrink-0'>
        <div className='flex items-center gap-2 flex-wrap'>
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
      </div>

      {/* File List */}
      <ScrollArea className='flex-1 min-h-0'>
        <div className='p-4'>
          {files.length === 0 ? (
            <div className='text-center py-12 text-muted-foreground'>
              <Folder className='h-12 w-12 mx-auto mb-4 opacity-50' />
              <p>No media files found in this directory</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-12'></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className='w-32'>Type</TableHead>
                  <TableHead className='w-32 text-right'>Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow
                    key={file.path}
                    className={`cursor-pointer hover:bg-muted/50 ${playingPath === file.path ? 'bg-primary/10' : ''}`}
                    onClick={() => handleFileClick(file)}
                  >
                    <TableCell>{getIcon(file.type)}</TableCell>
                    <TableCell className='font-medium'>
                      {file.name}
                      {playingPath === file.path && <span className='ml-2 text-xs text-primary'>• Playing</span>}
                    </TableCell>
                    <TableCell className='text-muted-foreground capitalize'>
                      {file.isDirectory ? 'Folder' : file.type}
                    </TableCell>
                    <TableCell className='text-right text-muted-foreground'>
                      {file.isDirectory ? '—' : formatFileSize(file.size)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function FileList(props: FileListProps) {
  return (
    <Suspense fallback={<div className='flex items-center justify-center h-full'>Loading...</div>}>
      <FileListInner {...props} />
    </Suspense>
  )
}
