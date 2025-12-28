'use client'

import * as React from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { Pencil, Trash2, Edit3 } from 'lucide-react'
import { FileItem } from '@/lib/types'
import { useLongPress } from '@/lib/use-long-press'

interface FileContextMenuProps {
  file: FileItem
  children: React.ReactElement
  onSetIcon: (file: FileItem, e?: Event) => void
  onRename?: (file: FileItem) => void
  onDelete?: (file: FileItem) => void
  isEditable?: boolean
}

export function FileContextMenu({
  file,
  children,
  onSetIcon,
  onRename,
  onDelete,
  isEditable = false,
}: FileContextMenuProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement>(null)

  // Handle long press for touch devices
  const longPressHandlers = useLongPress({
    onLongPress: (e) => {
      e.preventDefault()
      setOpen(true)
    },
    delay: 500,
  })

  const handleSetIcon = () => {
    onSetIcon(file)
    setOpen(false)
  }

  const handleRename = () => {
    if (onRename) {
      onRename(file)
    }
    setOpen(false)
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete(file)
    }
    setOpen(false)
  }

  // Clone the child element and add the long press handlers and ref
  const childWithHandlers = React.cloneElement(children, {
    ...longPressHandlers,
    ref: triggerRef,
  })

  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger asChild>{childWithHandlers}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleSetIcon}>
          <Pencil className='mr-2 h-4 w-4' />
          Set icon
        </ContextMenuItem>
        {isEditable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleRename}>
              <Edit3 className='mr-2 h-4 w-4' />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleDelete} className='text-destructive'>
              <Trash2 className='mr-2 h-4 w-4' />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
