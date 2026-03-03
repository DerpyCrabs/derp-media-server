'use client'

import { useCallback, useRef, type ReactNode } from 'react'
import { Rnd } from 'react-rnd'
import { Minus, Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace, type WorkspaceWindow } from '@/lib/use-workspace'

interface WindowProps {
  windowId: string
  children: ReactNode
}

const TASKBAR_HEIGHT = 44

export function Window({ windowId, children }: WindowProps) {
  const win = useWorkspace((s) => s.windows.find((w) => w.id === windowId)) as
    | WorkspaceWindow
    | undefined
  const focusedWindowId = useWorkspace((s) => s.focusedWindowId)
  const focusWindow = useWorkspace((s) => s.focusWindow)
  const closeWindow = useWorkspace((s) => s.closeWindow)
  const minimizeWindow = useWorkspace((s) => s.minimizeWindow)
  const toggleMaximize = useWorkspace((s) => s.toggleMaximize)
  const moveWindow = useWorkspace((s) => s.moveWindow)
  const resizeWindow = useWorkspace((s) => s.resizeWindow)

  const rndRef = useRef<Rnd>(null)

  const handleMouseDown = useCallback(() => {
    if (focusedWindowId !== windowId) {
      focusWindow(windowId)
    }
  }, [focusedWindowId, windowId, focusWindow])

  if (!win || win.minimized) return null

  const isFocused = focusedWindowId === windowId
  const isMaximized = win.maximized

  const position = isMaximized ? { x: 0, y: 0 } : win.position
  const size = isMaximized
    ? {
        width: typeof window !== 'undefined' ? window.innerWidth : 1200,
        height: typeof window !== 'undefined' ? window.innerHeight - TASKBAR_HEIGHT : 700,
      }
    : win.size

  return (
    <Rnd
      ref={rndRef}
      position={position}
      size={size}
      style={{ zIndex: win.zIndex }}
      disableDragging={isMaximized}
      enableResizing={!isMaximized}
      dragHandleClassName='window-drag-handle'
      minWidth={280}
      minHeight={180}
      bounds='parent'
      onDragStop={(_e, d) => {
        if (!isMaximized) moveWindow(windowId, { x: d.x, y: d.y })
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        resizeWindow(windowId, {
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        })
        moveWindow(windowId, { x: pos.x, y: pos.y })
      }}
      onMouseDown={handleMouseDown}
      className={`absolute ${isFocused ? 'shadow-2xl' : 'shadow-lg'}`}
    >
      <div
        className={`flex flex-col h-full rounded-lg border overflow-hidden ${
          isFocused ? 'border-primary/40 bg-background' : 'border-border bg-background/95'
        }`}
      >
        {/* Title bar */}
        <div
          className='window-drag-handle flex items-center justify-between h-9 px-2 border-b bg-muted/50 cursor-grab active:cursor-grabbing shrink-0 select-none'
          onDoubleClick={() => toggleMaximize(windowId)}
        >
          <span className='text-sm font-medium truncate flex-1 px-1'>{win.title}</span>
          <div className='flex items-center gap-0.5'>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6'
              onClick={(e) => {
                e.stopPropagation()
                minimizeWindow(windowId)
              }}
            >
              <Minus className='h-3.5 w-3.5' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6'
              onClick={(e) => {
                e.stopPropagation()
                toggleMaximize(windowId)
              }}
            >
              {isMaximized ? (
                <Minimize2 className='h-3.5 w-3.5' />
              ) : (
                <Maximize2 className='h-3.5 w-3.5' />
              )}
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6 hover:bg-destructive/20 hover:text-destructive'
              onClick={(e) => {
                e.stopPropagation()
                closeWindow(windowId)
              }}
            >
              <X className='h-3.5 w-3.5' />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className='flex-1 overflow-auto'>{children}</div>
      </div>
    </Rnd>
  )
}
