'use client'

import {
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  File,
  FolderOpen,
  FileQuestion,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace, type WindowType } from '@/lib/use-workspace'

const typeIcons: Record<WindowType, React.ElementType> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  pdf: FileText,
  text: FileText,
  unsupported: FileQuestion,
  'file-browser': FolderOpen,
}

export function Taskbar() {
  const windows = useWorkspace((s) => s.windows)
  const focusedWindowId = useWorkspace((s) => s.focusedWindowId)
  const focusWindow = useWorkspace((s) => s.focusWindow)
  const minimizeWindow = useWorkspace((s) => s.minimizeWindow)

  const handleClick = (id: string) => {
    const win = windows.find((w) => w.id === id)
    if (!win) return

    if (win.minimized) {
      focusWindow(id)
      useWorkspace.setState((s) => ({
        windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: false } : w)),
      }))
    } else if (focusedWindowId === id) {
      minimizeWindow(id)
    } else {
      focusWindow(id)
    }
  }

  const sidebarDocked = useWorkspace((s) => s.sidebarDocked)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)

  return (
    <div className='h-11 border-t bg-muted/30 flex items-center gap-1 px-2 shrink-0'>
      <Button
        variant='ghost'
        size='sm'
        className='h-8 w-8 p-0 shrink-0'
        onClick={toggleSidebar}
        title={sidebarDocked ? 'Hide sidebar' : 'Show sidebar'}
      >
        {sidebarDocked ? (
          <PanelLeftClose className='h-4 w-4' />
        ) : (
          <PanelLeftOpen className='h-4 w-4' />
        )}
      </Button>
      <div className='w-px h-6 bg-border mx-0.5 shrink-0' />
      {windows.map((win) => {
        const Icon = typeIcons[win.type] || File
        const isFocused = focusedWindowId === win.id && !win.minimized
        return (
          <Button
            key={win.id}
            variant={isFocused ? 'default' : 'ghost'}
            size='sm'
            className='h-8 max-w-[180px] gap-1.5 text-xs'
            onClick={() => handleClick(win.id)}
            title={win.title}
          >
            <Icon className='h-3.5 w-3.5 shrink-0' />
            <span className='truncate'>{win.title}</span>
          </Button>
        )
      })}
      {windows.length === 0 && (
        <span className='text-xs text-muted-foreground px-2'>
          Open files from the sidebar to get started
        </span>
      )}
    </div>
  )
}
