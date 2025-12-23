'use client'

import { Button } from '@/components/ui/button'
import {
  ChevronRight,
  Home,
  List,
  LayoutGrid,
  FolderPlus,
  FilePlus,
  Trash2,
  MoreHorizontal,
} from 'lucide-react'
import { useEffect, useRef, useState, useMemo } from 'react'

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
  const breadcrumbs = useMemo(() => {
    const pathParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
    return [
      { name: 'Home', path: '' },
      ...pathParts.map((part, index) => ({
        name: part,
        path: pathParts.slice(0, index + 1).join('/'),
      })),
    ]
  }, [currentPath])

  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(
    new Set(breadcrumbs.map((_, i) => i)),
  )
  const [showEllipsis, setShowEllipsis] = useState(false)

  useEffect(() => {
    const calculateVisibleBreadcrumbs = () => {
      if (!containerRef.current || !measureRef.current || breadcrumbs.length <= 3) {
        // If 3 or fewer breadcrumbs, show all
        setVisibleIndices(new Set(breadcrumbs.map((_, i) => i)))
        setShowEllipsis(false)
        return
      }

      // Get available width from the container that fills the space
      const availableWidth = containerRef.current.clientWidth

      // Get the gap size from computed styles for breadcrumbs
      const computedStyle = window.getComputedStyle(containerRef.current)
      const gap = parseFloat(computedStyle.gap) || 0

      // Measure all individual crumb widths (including separators)
      const crumbElements = measureRef.current.children
      const crumbWidths: number[] = []

      for (let i = 0; i < crumbElements.length; i++) {
        const el = crumbElements[i] as HTMLElement
        crumbWidths.push(el.offsetWidth)
      }

      // Ellipsis width is the last measured element
      const ellipsisWidth = (crumbElements[crumbElements.length - 1] as HTMLElement).offsetWidth

      // Helper function to calculate total width including gaps
      const calculateTotalWidth = (indices: number[]) => {
        const itemsWidth = indices.reduce((sum, idx) => sum + (crumbWidths[idx] || 0), 0)
        const gapsWidth = (indices.length - 1) * gap
        return itemsWidth + gapsWidth
      }

      // First check if all breadcrumbs fit without ellipsis
      const allIndices = Array.from({ length: breadcrumbs.length }, (_, i) => i)
      const totalWidth = calculateTotalWidth(allIndices)

      if (totalWidth <= availableWidth) {
        setVisibleIndices(new Set(allIndices))
        setShowEllipsis(false)
        return
      }

      // Calculate required indices: 0 (Home) and last 2
      const requiredIndices = [0, breadcrumbs.length - 2, breadcrumbs.length - 1]

      // Try to fit middle breadcrumbs one by one
      const visible = [...requiredIndices]

      for (let i = 1; i < breadcrumbs.length - 2; i++) {
        // Try adding this breadcrumb
        const testIndices = [...visible, i].sort((a, b) => a - b)
        // Calculate width with ellipsis
        const testWidth = calculateTotalWidth(testIndices) + ellipsisWidth + gap

        if (testWidth <= availableWidth) {
          visible.push(i)
        } else {
          // Can't fit any more, stop
          break
        }
      }

      // Sort the visible indices
      visible.sort((a, b) => a - b)

      // Show ellipsis if we couldn't fit all breadcrumbs
      const allVisible = visible.length === breadcrumbs.length
      setShowEllipsis(!allVisible)
      setVisibleIndices(new Set(visible))
    }

    calculateVisibleBreadcrumbs()

    const resizeObserver = new ResizeObserver(calculateVisibleBreadcrumbs)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [breadcrumbs])

  const renderBreadcrumb = (
    crumb: { name: string; path: string },
    index: number,
    isVisible: boolean = true,
  ) => (
    <div
      key={crumb.path}
      className='flex items-center gap-2'
      style={
        !isVisible
          ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }
          : undefined
      }
    >
      {index > 0 && <ChevronRight className='h-4 w-4 text-muted-foreground' />}
      <Button
        variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
        size='sm'
        onClick={() => onNavigate(crumb.path)}
        onMouseEnter={() => onFolderHover(crumb.path)}
        className='gap-1.5 text-sm h-8 px-2.5'
        disabled={!isVisible}
      >
        {index === 0 && <Home className='h-4 w-4' />}
        {crumb.name}
      </Button>
    </div>
  )

  return (
    <div className='p-1.5 lg:p-2 border-b border-border bg-muted/30 shrink-0'>
      <div className='flex items-center justify-between gap-1.5 lg:gap-2'>
        {/* Measurement container - invisible */}
        <div
          ref={measureRef}
          className='absolute left-0 top-0 flex items-center gap-1 lg:gap-2'
          style={{ visibility: 'hidden', pointerEvents: 'none' }}
        >
          {breadcrumbs.map((crumb, index) => renderBreadcrumb(crumb, index, false))}
          {/* Measure ellipsis button too */}
          <div className='flex items-center gap-2'>
            <ChevronRight className='h-4 w-4 text-muted-foreground' />
            <Button variant='ghost' size='sm' className='h-8 px-2.5' disabled>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Visible breadcrumbs */}
        <div
          ref={containerRef}
          className='flex items-center gap-1 lg:gap-2 flex-wrap min-w-0 flex-1'
        >
          {breadcrumbs.map((crumb, index) => {
            // Show Home (0)
            if (index === 0) {
              return renderBreadcrumb(crumb, index)
            }

            // Show ellipsis before last 2 items if needed
            if (showEllipsis && index === breadcrumbs.length - 2) {
              const hasHiddenCrumbs = !visibleIndices.has(index - 1)
              if (hasHiddenCrumbs) {
                return (
                  <>
                    <div key={`ellipsis-${index}`} className='flex items-center gap-2'>
                      <ChevronRight className='h-4 w-4 text-muted-foreground' />
                      <Button variant='ghost' size='sm' className='h-8 px-2.5' disabled>
                        <MoreHorizontal className='h-4 w-4' />
                      </Button>
                    </div>
                    {renderBreadcrumb(crumb, index)}
                  </>
                )
              }
            }

            // Show visible crumbs
            if (visibleIndices.has(index)) {
              return renderBreadcrumb(crumb, index)
            }

            return null
          })}
        </div>
        <div className='flex gap-1 items-center'>
          {isEditable && (
            <>
              <Button
                variant='outline'
                size='icon'
                onClick={onCreateFolder}
                title='Create new folder'
                className='h-8 w-8'
              >
                <FolderPlus className='h-4 w-4' />
              </Button>
              <Button
                variant='outline'
                size='icon'
                onClick={onCreateFile}
                title='Create new file'
                className='h-8 w-8'
              >
                <FilePlus className='h-4 w-4' />
              </Button>
              {/* Show delete button only when inside an empty folder */}
              {showDeleteButton && (
                <Button
                  variant='outline'
                  size='icon'
                  onClick={onDeleteFolder}
                  className='text-destructive hover:text-destructive h-8 w-8'
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
            className='h-8 w-8 p-0'
          >
            <List className='h-4 w-4' />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size='sm'
            onClick={() => onViewModeChange('grid')}
            className='h-8 w-8 p-0'
          >
            <LayoutGrid className='h-4 w-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}
