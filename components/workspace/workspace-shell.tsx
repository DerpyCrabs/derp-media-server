'use client'

import { useCallback } from 'react'
import { useWorkspace, type WorkspaceWindow } from '@/lib/use-workspace'
import { Window } from '@/components/workspace/window'
import { Taskbar } from '@/components/workspace/taskbar'
import { FileBrowserPanel } from '@/components/workspace/file-browser-panel'
import { ImageViewerContent } from '@/components/viewers/image-viewer-content'
import { VideoPlayerContent } from '@/components/viewers/video-player-content'
import { PdfViewerContent } from '@/components/viewers/pdf-viewer-content'
import { TextViewerContent } from '@/components/viewers/text-viewer-content'
import { isPathEditable } from '@/lib/utils'

interface WorkspaceShellProps {
  editableFolders: string[]
}

function WindowContent({
  win,
  editableFolders,
}: {
  win: WorkspaceWindow
  editableFolders: string[]
}) {
  const closeWindow = useWorkspace((s) => s.closeWindow)
  const onClose = useCallback(() => closeWindow(win.id), [closeWindow, win.id])

  const filePath = win.filePath || ''
  const fileName = filePath.split(/[/\\]/).pop() || win.title

  switch (win.type) {
    case 'image':
      return (
        <ImageViewerContent
          mediaUrl={`/api/media/${encodeURIComponent(filePath)}`}
          fileName={fileName}
          onClose={onClose}
          downloadUrl={`/api/media/${encodeURIComponent(filePath)}`}
        />
      )

    case 'video':
      return (
        <VideoPlayerContent
          src={`/api/media/${filePath}`}
          fileName={fileName}
          maxHeight='100%'
          aspectRatio='16 / 9'
        />
      )

    case 'audio':
      return (
        <div className='flex items-center justify-center h-full p-4'>
          <audio controls className='w-full' src={`/api/media/${filePath}`}>
            Your browser does not support the audio element.
          </audio>
        </div>
      )

    case 'pdf':
      return (
        <PdfViewerContent
          mediaUrl={`/api/media/${encodeURIComponent(filePath)}`}
          fileName={fileName}
          onClose={onClose}
          downloadUrl={`/api/media/${encodeURIComponent(filePath)}`}
        />
      )

    case 'text':
      return (
        <TextViewerContent
          filePath={filePath}
          onClose={onClose}
          fetchUrl={`/api/media/${encodeURIComponent(filePath)}`}
          queryKey={['text-content', filePath]}
          isEditable={isPathEditable(filePath, editableFolders)}
          saveContent={
            isPathEditable(filePath, editableFolders)
              ? async (content: string) => {
                  const res = await fetch('/api/files/edit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath, content }),
                  })
                  if (!res.ok) {
                    const data = await res.json()
                    throw new Error(data.error || 'Failed to save file')
                  }
                }
              : undefined
          }
          autoSaveEnabled={true}
          onToggleAutoSave={() => {}}
          isReadOnly={false}
          onToggleReadOnly={() => {}}
        />
      )

    case 'unsupported':
      return (
        <div className='flex flex-col items-center justify-center h-full gap-4 text-muted-foreground'>
          <p>Unsupported file type</p>
          <a
            href={`/api/media/${encodeURIComponent(filePath)}`}
            download={fileName}
            className='text-primary underline text-sm'
          >
            Download File
          </a>
        </div>
      )

    default:
      return null
  }
}

export function WorkspaceShell({ editableFolders }: WorkspaceShellProps) {
  const windows = useWorkspace((s) => s.windows)
  const sidebarDocked = useWorkspace((s) => s.sidebarDocked)

  return (
    <div className='h-screen flex flex-col'>
      <div className='flex-1 flex overflow-hidden'>
        {sidebarDocked && (
          <div className='w-72 shrink-0'>
            <FileBrowserPanel editableFolders={editableFolders} />
          </div>
        )}
        <div className='flex-1 relative bg-muted/20'>
          {windows
            .filter((w) => !w.minimized)
            .map((win) => (
              <Window key={win.id} windowId={win.id}>
                <WindowContent win={win} editableFolders={editableFolders} />
              </Window>
            ))}
          {windows.filter((w) => !w.minimized).length === 0 && (
            <div className='absolute inset-0 flex items-center justify-center text-muted-foreground'>
              <div className='text-center'>
                <p className='text-lg font-medium'>Workspace</p>
                <p className='text-sm mt-1'>
                  Browse files in the sidebar and click to open them in windows
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <Taskbar />
    </div>
  )
}
