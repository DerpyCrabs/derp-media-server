import * as React from 'react'
import { useCallback } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  Pencil,
  Pin,
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
  AppWindow,
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
  onOpenInWorkspace?: (file: FileItem) => void
  onAddToTaskbar?: (file: FileItem) => void
  /** When true, show "Open in new tab" for files too (workspace only). Default: false (folders only). */
  showOpenInNewTabForFiles?: boolean
  /** Workspace: when default open is "new tab", the context item opens a standalone window and shows this label. */
  contextOpenWorkspaceAsStandalone?: boolean
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
  onOpenInWorkspace,
  onAddToTaskbar,
  showOpenInNewTabForFiles = false,
  contextOpenWorkspaceAsStandalone = false,
  hasEditableFolders = false,
  isFavorite = false,
  isKnowledgeBase = false,
  isEditable = false,
  isShared = false,
}: FileContextMenuProps) {
  const onLongPress = useCallback((e: React.TouchEvent | React.MouseEvent | React.PointerEvent) => {
    e.preventDefault()
    const target = e.target as HTMLElement
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: (e as React.TouchEvent).touches?.[0]?.clientX || (e as React.MouseEvent).clientX,
      clientY: (e as React.TouchEvent).touches?.[0]?.clientY || (e as React.MouseEvent).clientY,
    })
    target.dispatchEvent(contextMenuEvent)
  }, [])

  const longPressHandlers = useLongPress({
    onLongPress,
    delay: 500,
  })

  const handleSetIcon = useCallback(() => {
    if (onSetIcon) onSetIcon(file)
  }, [onSetIcon, file])

  const handleRename = useCallback(() => {
    if (onRename) {
      onRename(file)
    }
  }, [onRename, file])

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(file)
    }
  }, [onDelete, file])

  const handleDownload = useCallback(() => {
    if (onDownload) {
      onDownload(file)
    }
  }, [onDownload, file])

  const handleToggleFavorite = useCallback(() => {
    if (onToggleFavorite) {
      onToggleFavorite(file)
    }
  }, [onToggleFavorite, file])

  const handleToggleKnowledgeBase = useCallback(() => {
    if (onToggleKnowledgeBase) {
      onToggleKnowledgeBase(file)
    }
  }, [onToggleKnowledgeBase, file])

  const handleShare = useCallback(() => {
    if (onShare) {
      onShare(file)
    }
  }, [onShare, file])

  const handleCopyShareLink = useCallback(() => {
    if (onCopyShareLink) {
      onCopyShareLink(file)
    }
  }, [onCopyShareLink, file])

  const handleMove = useCallback(() => {
    if (onMove) onMove(file)
  }, [onMove, file])

  const handleCopy = useCallback(() => {
    if (onCopy) onCopy(file)
  }, [onCopy, file])

  const handleOpenInNewTab = useCallback(() => {
    if (onOpenInNewTab) onOpenInNewTab(file)
  }, [onOpenInNewTab, file])

  const handleOpenInWorkspace = useCallback(() => {
    if (onOpenInWorkspace) onOpenInWorkspace(file)
  }, [onOpenInWorkspace, file])

  const handleAddToTaskbar = useCallback(() => {
    if (onAddToTaskbar) onAddToTaskbar(file)
  }, [onAddToTaskbar, file])

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
        {onOpenInNewTab && !file.isVirtual && (file.isDirectory || showOpenInNewTabForFiles) && (
          <ContextMenuItem onClick={handleOpenInNewTab}>
            {contextOpenWorkspaceAsStandalone ? (
              <AppWindow className='mr-2 h-4 w-4' />
            ) : (
              <ExternalLink className='mr-2 h-4 w-4' />
            )}
            {contextOpenWorkspaceAsStandalone ? 'Open in new window' : 'Open in new tab'}
          </ContextMenuItem>
        )}
        {onOpenInWorkspace && file.isDirectory && !file.isVirtual && (
          <ContextMenuItem onClick={handleOpenInWorkspace}>
            <AppWindow className='mr-2 h-4 w-4' />
            Open in Workspace
          </ContextMenuItem>
        )}
        {onAddToTaskbar && !file.isVirtual && (
          <ContextMenuItem onClick={handleAddToTaskbar}>
            <Pin className='mr-2 h-4 w-4' />
            Add to taskbar
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
