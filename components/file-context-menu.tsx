'use client'

import * as React from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  Pencil,
  Trash2,
  Edit3,
  Download,
  Star,
  Link,
  Copy,
  BookOpen,
  FolderInput,
  CopyPlus,
  ExternalLink,
} from 'lucide-react'
import { FileItem } from '@/lib/types'
import { useLongPress } from '@/lib/use-long-press'

interface FileContextMenuProps {
  file: FileItem
  children: React.ReactElement
  onSetIcon?: (file: FileItem, e?: Event) => void
  onRename?: (file: FileItem) => void
  onDelete?: (file: FileItem) => void
  onDownload?: (file: FileItem) => void
  onToggleFavorite?: (file: FileItem) => void
  onToggleKnowledgeBase?: (file: FileItem) => void
  onShare?: (file: FileItem) => void
  onCopyShareLink?: (file: FileItem) => void
  onMove?: (file: FileItem) => void
  onCopy?: (file: FileItem) => void
  onOpenInNewTab?: (file: FileItem) => void
  hasEditableFolders?: boolean
  isFavorite?: boolean
  isKnowledgeBase?: boolean
  isEditable?: boolean
  isShared?: boolean
}

export function FileContextMenu({
  file,
  children,
  onSetIcon,
  onRename,
  onDelete,
  onDownload,
  onToggleFavorite,
  onToggleKnowledgeBase,
  onShare,
  onCopyShareLink,
  onMove,
  onCopy,
  onOpenInNewTab,
  hasEditableFolders = false,
  isFavorite = false,
  isKnowledgeBase = false,
  isEditable = false,
  isShared = false,
}: FileContextMenuProps) {
  // Handle long press for touch devices to trigger context menu
  const longPressHandlers = useLongPress({
    onLongPress: (e) => {
      e.preventDefault()
      // Simulate a context menu event
      const target = e.target as HTMLElement
      const contextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: (e as React.TouchEvent).touches?.[0]?.clientX || (e as React.MouseEvent).clientX,
        clientY: (e as React.TouchEvent).touches?.[0]?.clientY || (e as React.MouseEvent).clientY,
      })
      target.dispatchEvent(contextMenuEvent)
    },
    delay: 500,
  })

  const handleSetIcon = () => {
    if (onSetIcon) onSetIcon(file)
  }

  const handleRename = () => {
    if (onRename) {
      onRename(file)
    }
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete(file)
    }
  }

  const handleDownload = () => {
    if (onDownload) {
      onDownload(file)
    }
  }

  const handleToggleFavorite = () => {
    if (onToggleFavorite) {
      onToggleFavorite(file)
    }
  }

  const handleToggleKnowledgeBase = () => {
    if (onToggleKnowledgeBase) {
      onToggleKnowledgeBase(file)
    }
  }

  const handleShare = () => {
    if (onShare) {
      onShare(file)
    }
  }

  const handleCopyShareLink = () => {
    if (onCopyShareLink) {
      onCopyShareLink(file)
    }
  }

  const handleMove = () => {
    if (onMove) onMove(file)
  }

  const handleCopy = () => {
    if (onCopy) onCopy(file)
  }

  const handleOpenInNewTab = () => {
    if (onOpenInNewTab) onOpenInNewTab(file)
  }

  // Clone the child element and add the long press handlers
  const childWithHandlers = React.cloneElement(children, longPressHandlers)

  return (
    <ContextMenu>
      <ContextMenuTrigger render={childWithHandlers} />
      <ContextMenuContent>
        {onSetIcon && (
          <ContextMenuItem onClick={handleSetIcon}>
            <Pencil className='mr-2 h-4 w-4' />
            Set icon
          </ContextMenuItem>
        )}
        {file.isDirectory && !file.isVirtual && onOpenInNewTab && (
          <ContextMenuItem onClick={handleOpenInNewTab}>
            <ExternalLink className='mr-2 h-4 w-4' />
            Open in new tab
          </ContextMenuItem>
        )}
        {file.isDirectory && (
          <>
            <ContextMenuItem onClick={handleToggleFavorite}>
              <Star
                className={`mr-2 h-4 w-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`}
              />
              {isFavorite ? 'Unfavorite' : 'Favorite'}
            </ContextMenuItem>
            <ContextMenuItem onClick={handleToggleKnowledgeBase}>
              <BookOpen
                className={`mr-2 h-4 w-4 ${isKnowledgeBase ? 'fill-primary text-primary' : ''}`}
              />
              {isKnowledgeBase ? 'Remove Knowledge Base' : 'Set as Knowledge Base'}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem onClick={handleDownload}>
          <Download className='mr-2 h-4 w-4' />
          Download{file.isDirectory ? ' as ZIP' : ''}
        </ContextMenuItem>
        {!file.isVirtual && hasEditableFolders && onCopy && (
          <ContextMenuItem onClick={handleCopy}>
            <CopyPlus className='mr-2 h-4 w-4' />
            Copy to...
          </ContextMenuItem>
        )}
        {file.shareToken && onCopyShareLink && (
          <ContextMenuItem onClick={handleCopyShareLink}>
            <Copy className='mr-2 h-4 w-4' />
            Copy share link
          </ContextMenuItem>
        )}
        {!file.isVirtual && !file.shareToken && (
          <ContextMenuItem onClick={handleShare}>
            <Link className={`mr-2 h-4 w-4 ${isShared ? 'text-primary' : ''}`} />
            {isShared ? 'Manage Share' : 'Share'}
          </ContextMenuItem>
        )}
        {(isEditable || file.shareToken) && (
          <>
            <ContextMenuSeparator />
            {file.shareToken ? (
              <ContextMenuItem onClick={handleDelete} className='text-destructive'>
                <Trash2 className='mr-2 h-4 w-4' />
                Revoke Share
              </ContextMenuItem>
            ) : (
              <>
                {onMove && (
                  <ContextMenuItem onClick={handleMove}>
                    <FolderInput className='mr-2 h-4 w-4' />
                    Move to...
                  </ContextMenuItem>
                )}
                {onRename && (
                  <ContextMenuItem onClick={handleRename}>
                    <Edit3 className='mr-2 h-4 w-4' />
                    Rename
                  </ContextMenuItem>
                )}
                {onDelete && (
                  <ContextMenuItem onClick={handleDelete} className='text-destructive'>
                    <Trash2 className='mr-2 h-4 w-4' />
                    Delete
                  </ContextMenuItem>
                )}
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
