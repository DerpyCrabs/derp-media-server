'use client'

import { Button } from '@/components/ui/button'
import { ChevronRight, Home, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, useMemo, Fragment } from 'react'
import { getIconComponent } from '@/lib/icon-utils'
import { FileContextMenu } from '@/components/file-context-menu'
import { FileItem, MediaType } from '@/lib/types'
import { isPathEditable } from '@/lib/utils'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'

interface BreadcrumbsProps {
  currentPath: string
  onNavigate: (path: string) => void
  onFolderHover: (path: string) => void
  customIcons?: Record<string, string>
  onContextSetIcon?: (file: FileItem) => void
  onContextRename?: (file: FileItem) => void
  onContextDelete?: (file: FileItem) => void
  onContextDownload?: (file: FileItem) => void
  onContextToggleFavorite?: (file: FileItem) => void
  onContextShare?: (file: FileItem) => void
  favorites?: string[]
  editableFolders?: string[]
  shares?: ShareLink[]
}

export function Breadcrumbs({
  currentPath,
  onNavigate,
  onFolderHover,
  customIcons = {},
  onContextSetIcon,
  onContextRename,
  onContextDelete,
  onContextDownload,
  onContextToggleFavorite,
  onContextShare,
  favorites = [],
  editableFolders = [],
  shares = [],
}: BreadcrumbsProps) {
  const hasContextMenu = Boolean(onContextSetIcon)
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
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false)
  const [wouldShowEllipsis, setWouldShowEllipsis] = useState(false)

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
        const safetyMargin = 10 // Add a small margin for safety
        return itemsWidth + gapsWidth + safetyMargin
      }

      // First check if all breadcrumbs fit without ellipsis
      const allIndices = Array.from({ length: breadcrumbs.length }, (_, i) => i)
      const totalWidth = calculateTotalWidth(allIndices)

      // If manually expanded, show all breadcrumbs but check if they would naturally fit
      if (isManuallyExpanded) {
        setVisibleIndices(new Set(breadcrumbs.map((_, i) => i)))
        setShowEllipsis(false)
        // Only show collapse button if breadcrumbs wouldn't naturally fit
        setWouldShowEllipsis(totalWidth > availableWidth)
        return
      }

      if (totalWidth <= availableWidth) {
        setVisibleIndices(new Set(allIndices))
        setShowEllipsis(false)
        setWouldShowEllipsis(false)
        setIsManuallyExpanded(false) // Reset manual expansion when everything fits
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
      setWouldShowEllipsis(!allVisible)
      setVisibleIndices(new Set(visible))
    }

    calculateVisibleBreadcrumbs()

    const resizeObserver = new ResizeObserver(calculateVisibleBreadcrumbs)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [breadcrumbs, isManuallyExpanded])

  const renderBreadcrumb = (
    crumb: { name: string; path: string },
    index: number,
    isVisible: boolean = true,
  ) => {
    // Get custom icon for this breadcrumb
    const customIconName = customIcons[crumb.path]
    const CustomIcon = customIconName ? getIconComponent(customIconName) : null

    const folderItem: FileItem = {
      name: crumb.name,
      path: crumb.path,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      isVirtual:
        crumb.path === VIRTUAL_FOLDERS.FAVORITES || crumb.path === VIRTUAL_FOLDERS.MOST_PLAYED,
    }

    const button = (
      <Button
        variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
        size='sm'
        onClick={() => onNavigate(crumb.path)}
        onMouseEnter={() => onFolderHover(crumb.path)}
        className='gap-1.5 text-sm h-8 px-2.5'
        disabled={!isVisible}
      >
        {CustomIcon ? (
          <CustomIcon className='h-4 w-4' />
        ) : (
          index === 0 && <Home className='h-4 w-4' />
        )}
        {crumb.name}
      </Button>
    )

    const crumbContent = hasContextMenu ? (
      <FileContextMenu
        file={folderItem}
        onSetIcon={onContextSetIcon!}
        onRename={onContextRename}
        onDelete={onContextDelete}
        onDownload={onContextDownload}
        onToggleFavorite={onContextToggleFavorite}
        onShare={onContextShare}
        isFavorite={favorites.includes(crumb.path)}
        isEditable={isPathEditable(crumb.path, editableFolders)}
        isShared={shares.some((s) => s.path === crumb.path)}
      >
        {button}
      </FileContextMenu>
    ) : (
      button
    )

    return (
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
        {crumbContent}
      </div>
    )
  }

  const handleEllipsisClick = () => {
    setIsManuallyExpanded(!isManuallyExpanded)
  }

  return (
    <>
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
      <div ref={containerRef} className='flex items-center gap-1 lg:gap-2 flex-wrap min-w-0 flex-1'>
        {breadcrumbs.map((crumb, index) => {
          // Show Home (0)
          if (index === 0) {
            return renderBreadcrumb(crumb, index)
          }

          // Show ellipsis/collapse button before last 2 items if needed
          if (showEllipsis && index === breadcrumbs.length - 2) {
            const hasHiddenCrumbs = !visibleIndices.has(index - 1)
            if (hasHiddenCrumbs) {
              return (
                <Fragment key='ellipsis'>
                  <div className='flex items-center gap-2'>
                    <ChevronRight className='h-4 w-4 text-muted-foreground' />
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-8 px-2.5'
                      onClick={handleEllipsisClick}
                    >
                      <MoreHorizontal className='h-4 w-4' />
                    </Button>
                  </div>
                  {renderBreadcrumb(crumb, index)}
                </Fragment>
              )
            }
          }

          // Show visible crumbs
          if (visibleIndices.has(index)) {
            return renderBreadcrumb(crumb, index)
          }

          return null
        })}

        {/* Show collapse button when manually expanded */}
        {isManuallyExpanded && wouldShowEllipsis && (
          <div className='flex items-center gap-2'>
            <ChevronRight className='h-4 w-4 text-muted-foreground' />
            <Button
              variant='ghost'
              size='sm'
              className='h-8 px-2.5'
              onClick={handleEllipsisClick}
              title='Collapse breadcrumbs'
            >
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
