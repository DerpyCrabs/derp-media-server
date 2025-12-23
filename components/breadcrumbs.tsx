'use client'

import { Button } from '@/components/ui/button'
import { ChevronRight, Home, List, LayoutGrid, FolderPlus, FilePlus, Trash2 } from 'lucide-react'

interface BreadcrumbsProps {
  currentPath: string
  onNavigate: (path: string) => void
  onFolderHover: (path: string) => void
  isEditable: boolean
  onCreateFolder: () => void
  onCreateFile: () => void
  onDeleteFolder: () => void
  showDeleteButton: boolean
  viewMode: 'list' | 'grid'
  onViewModeChange: (mode: 'list' | 'grid') => void
}

export function Breadcrumbs({
  currentPath,
  onNavigate,
  onFolderHover,
  isEditable,
  onCreateFolder,
  onCreateFile,
  onDeleteFolder,
  showDeleteButton,
  viewMode,
  onViewModeChange,
}: BreadcrumbsProps) {
  // Build breadcrumb path
  const pathParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
  const breadcrumbs = [
    { name: 'Home', path: '' },
    ...pathParts.map((part, index) => ({
      name: part,
      path: pathParts.slice(0, index + 1).join('/'),
    })),
  ]

  return (
    <div className='p-2 lg:p-3 border-b border-border bg-muted/30 shrink-0'>
      <div className='flex items-center justify-between gap-2 lg:gap-4'>
        <div className='flex items-center gap-1 lg:gap-2 flex-wrap'>
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path} className='flex items-center gap-2'>
              {index > 0 && <ChevronRight className='h-4 w-4 text-muted-foreground' />}
              <Button
                variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
                size='sm'
                onClick={() => onNavigate(crumb.path)}
                onMouseEnter={() => onFolderHover(crumb.path)}
                className='gap-2'
              >
                {index === 0 && <Home className='h-4 w-4' />}
                {crumb.name}
              </Button>
            </div>
          ))}
        </div>
        <div className='flex gap-1 items-center'>
          {isEditable && (
            <>
              <Button
                variant='outline'
                size='icon'
                onClick={onCreateFolder}
                title='Create new folder'
              >
                <FolderPlus className='h-4 w-4' />
              </Button>
              <Button variant='outline' size='icon' onClick={onCreateFile} title='Create new file'>
                <FilePlus className='h-4 w-4' />
              </Button>
              {/* Show delete button only when inside an empty folder */}
              {showDeleteButton && (
                <Button
                  variant='outline'
                  size='icon'
                  onClick={onDeleteFolder}
                  className='text-destructive hover:text-destructive'
                  title='Delete this empty folder'
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              )}
              <div className='w-px h-6 bg-border mx-1' />
            </>
          )}
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size='sm'
            onClick={() => onViewModeChange('list')}
          >
            <List className='h-4 w-4' />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size='sm'
            onClick={() => onViewModeChange('grid')}
          >
            <LayoutGrid className='h-4 w-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}
