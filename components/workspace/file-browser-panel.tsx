'use client'

import { useState, useCallback, useMemo } from 'react'
import { ChevronRight, Folder, List, LayoutGrid, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileItem, MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { useFiles, usePrefetchFiles } from '@/lib/use-files'
import { useFileIcon } from '@/lib/use-file-icon'
import { FileListView } from '@/components/file-list-view'
import { FileGridView } from '@/components/file-grid-view'
import { useWorkspace, type WindowType } from '@/lib/use-workspace'

interface FileBrowserPanelProps {
  initialPath?: string
  editableFolders?: string[]
}

function fileTypeToWindowType(file: FileItem): WindowType {
  const ext = file.extension?.toLowerCase() || file.name.split('.').pop()?.toLowerCase() || ''
  const type = getMediaType(ext)
  switch (type) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    default:
      break
  }
  if (ext === 'pdf') return 'pdf'
  const textExts = [
    'txt',
    'md',
    'json',
    'xml',
    'csv',
    'log',
    'yaml',
    'yml',
    'ini',
    'conf',
    'sh',
    'bat',
    'ps1',
    'js',
    'ts',
    'jsx',
    'tsx',
    'css',
    'scss',
    'html',
    'py',
    'java',
    'c',
    'cpp',
    'h',
    'cs',
    'go',
    'rs',
    'php',
    'rb',
    'swift',
    'kt',
    'sql',
  ]
  if (textExts.includes(ext)) return 'text'
  return 'unsupported'
}

export function FileBrowserPanel({
  initialPath = '',
  editableFolders = [],
}: FileBrowserPanelProps) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const sidebarDocked = useWorkspace((s) => s.sidebarDocked)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const openWindow = useWorkspace((s) => s.openWindow)

  const { data: files = [] } = useFiles(currentPath)
  const { prefetchFiles } = usePrefetchFiles()

  const { getIcon } = useFileIcon({
    customIcons: {},
    playingPath: null,
    currentFile: null,
    mediaPlayerIsPlaying: false,
    mediaType: null,
  })

  const handleFileClick = useCallback(
    (file: FileItem) => {
      if (file.isDirectory) {
        setCurrentPath(file.path)
      } else {
        const windowType = fileTypeToWindowType(file)
        openWindow({
          type: windowType,
          title: file.name,
          filePath: file.path,
        })
      }
    },
    [openWindow],
  )

  const handleParentDirectory = useCallback(() => {
    if (!currentPath) return
    const parts = currentPath.split(/[/\\]/).filter(Boolean)
    if (parts.length <= 1) {
      setCurrentPath('')
    } else {
      setCurrentPath(parts.slice(0, -1).join('/'))
    }
  }, [currentPath])

  const handleFolderHover = useCallback(
    (path: string) => {
      prefetchFiles(path)
    },
    [prefetchFiles],
  )

  const breadcrumbs = useMemo(() => {
    const parts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
    return [
      { name: 'Root', path: '' },
      ...parts.map((part, i) => ({
        name: part,
        path: parts.slice(0, i + 1).join('/'),
      })),
    ]
  }, [currentPath])

  return (
    <div className='flex flex-col h-full border-r bg-background'>
      {/* Toolbar */}
      <div className='p-1.5 border-b bg-muted/30 shrink-0'>
        <div className='flex items-center justify-between gap-1'>
          <div className='flex items-center gap-1 flex-1 min-w-0 overflow-x-auto'>
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.path} className='flex items-center gap-1 shrink-0'>
                {index > 0 && <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />}
                <Button
                  variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
                  size='sm'
                  onClick={() => setCurrentPath(crumb.path)}
                  className='gap-1 text-xs h-7 px-2'
                >
                  {index === 0 && <Folder className='h-3.5 w-3.5' />}
                  {crumb.name}
                </Button>
              </div>
            ))}
          </div>
          <div className='flex items-center gap-0.5 shrink-0'>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('list')}
              className='h-7 w-7 p-0'
            >
              <List className='h-3.5 w-3.5' />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('grid')}
              className='h-7 w-7 p-0'
            >
              <LayoutGrid className='h-3.5 w-3.5' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={toggleSidebar}
              className='h-7 w-7 p-0'
              title={sidebarDocked ? 'Undock sidebar' : 'Dock sidebar'}
            >
              {sidebarDocked ? (
                <PanelLeftClose className='h-3.5 w-3.5' />
              ) : (
                <PanelLeftOpen className='h-3.5 w-3.5' />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* File listing */}
      <div className='flex-1 overflow-auto'>
        {viewMode === 'list' ? (
          <FileListView
            files={files}
            currentPath={currentPath}
            editableFolders={editableFolders}
            onFileClick={handleFileClick}
            onFolderHover={handleFolderHover}
            onParentDirectory={handleParentDirectory}
            getIcon={getIcon}
          />
        ) : (
          <FileGridView
            files={files}
            currentPath={currentPath}
            editableFolders={editableFolders}
            onFileClick={handleFileClick}
            onFolderHover={handleFolderHover}
            onParentDirectory={handleParentDirectory}
            getIcon={getIcon}
          />
        )}
      </div>
    </div>
  )
}
