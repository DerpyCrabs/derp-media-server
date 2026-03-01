'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileItem } from '@/lib/types'
import { Folder, ArrowUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

type BrowseFolder = { name: string; navPath: string }

type MoveOrCopyMode = 'move' | 'copy'

interface MoveToDialogProps {
  isOpen: boolean
  onClose: () => void
  fileName: string
  filePath: string
  onMove: (destinationDir: string) => void
  isPending?: boolean
  error?: Error | null
  editableFolders?: string[]
  shareToken?: string
  shareRootPath?: string
  /** When 'copy', shows "Copy to" UI; destination must be editable folder */
  mode?: MoveOrCopyMode
}

export function MoveToDialog({
  isOpen,
  onClose,
  fileName,
  filePath,
  onMove,
  isPending = false,
  error = null,
  editableFolders = [],
  shareToken,
  shareRootPath,
  mode = 'move',
}: MoveToDialogProps) {
  const isCopy = mode === 'copy'
  const sourceDir = useMemo(() => {
    const parts = filePath.split(/[/\\]/).filter(Boolean)
    return parts.slice(0, -1).join('/')
  }, [filePath])

  const sourceRoot = useMemo(() => {
    if (shareToken) return ''
    const normalized = filePath.replace(/\\/g, '/')
    for (const folder of editableFolders) {
      const nf = folder.replace(/\\/g, '/')
      if (normalized === nf || normalized.startsWith(nf + '/')) return nf
    }
    return editableFolders[0]?.replace(/\\/g, '/') || ''
  }, [filePath, editableFolders, shareToken])

  const [selectedRoot, setSelectedRoot] = useState(sourceRoot)
  const [browsePath, setBrowsePath] = useState(sourceDir)

  useEffect(() => {
    if (isOpen) {
      const root = sourceRoot
      const dir = sourceDir.replace(/\\/g, '/')
      setSelectedRoot(root)
      if (shareToken || dir === root || dir.startsWith(root + '/')) {
        setBrowsePath(dir)
      } else {
        setBrowsePath(root)
      }
    }
  }, [isOpen, sourceRoot, sourceDir, shareToken])

  const normalizedBrowse = browsePath.replace(/\\/g, '/')
  const normalizedRoot = selectedRoot.replace(/\\/g, '/')

  const stripShareRoot = useCallback(
    (p: string) => {
      if (!shareRootPath) return p
      const norm = p.replace(/\\/g, '/')
      const root = shareRootPath.replace(/\\/g, '/')
      return norm.startsWith(root + '/') ? norm.slice(root.length + 1) : norm
    },
    [shareRootPath],
  )

  const { data: folders = [], isLoading } = useQuery<BrowseFolder[]>({
    queryKey: shareToken
      ? ['move-folders', 'share', shareToken, browsePath]
      : ['move-folders', browsePath],
    queryFn: async () => {
      const url = shareToken
        ? `/api/share/${shareToken}/files?dir=${encodeURIComponent(browsePath)}`
        : `/api/files?dir=${encodeURIComponent(browsePath)}`
      const res = await fetch(url)
      if (!res.ok) return []
      const data = await res.json()
      const files: FileItem[] = data.files || []
      const normalizedFilePath = filePath.replace(/\\/g, '/')
      return files
        .filter((f) => f.isDirectory)
        .map((f) => ({
          name: f.name,
          navPath: shareToken ? stripShareRoot(f.path) : f.path.replace(/\\/g, '/'),
        }))
        .filter((f) => {
          if (f.navPath === normalizedFilePath) return false
          if (f.navPath.startsWith(normalizedFilePath + '/')) return false
          return true
        })
    },
    enabled: isOpen,
    staleTime: 1000 * 30,
  })

  const canGoUp = shareToken ? !!browsePath : normalizedBrowse !== normalizedRoot

  const goUp = useCallback(() => {
    const parts = browsePath.split(/[/\\]/).filter(Boolean)
    setBrowsePath(parts.slice(0, -1).join('/'))
  }, [browsePath])

  const handleRootChange = useCallback((root: string) => {
    const normalized = root.replace(/\\/g, '/')
    setSelectedRoot(normalized)
    setBrowsePath(normalized)
  }, [])

  const isSameAsSource = normalizedBrowse === sourceDir.replace(/\\/g, '/')

  const displayPath = useMemo(() => {
    if (shareToken) {
      return browsePath ? `/${browsePath}` : '/'
    }
    if (normalizedBrowse === normalizedRoot) return '/'
    return '/' + normalizedBrowse.slice(normalizedRoot.length + 1)
  }, [browsePath, normalizedBrowse, normalizedRoot, shareToken])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='truncate pr-6'>
            {isCopy ? 'Copy' : 'Move'} &ldquo;{fileName}&rdquo;
          </DialogTitle>
          <DialogDescription>
            {isCopy ? 'Choose an editable destination folder' : 'Choose a destination folder'}
          </DialogDescription>
        </DialogHeader>

        {!shareToken && editableFolders.length > 1 && (
          <div className='flex gap-1.5 flex-wrap'>
            {editableFolders.map((folder) => {
              const nf = folder.replace(/\\/g, '/')
              return (
                <Button
                  key={folder}
                  variant={selectedRoot === nf ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => handleRootChange(folder)}
                  className='text-xs h-7'
                >
                  {folder}
                </Button>
              )
            })}
          </div>
        )}

        <div className='flex items-center gap-1.5 text-sm text-muted-foreground px-1'>
          <Folder className='h-3.5 w-3.5 shrink-0' />
          <span className='font-mono text-xs truncate'>{displayPath}</span>
        </div>

        <div className='border rounded-md max-h-64 overflow-y-auto'>
          {isLoading ? (
            <div className='flex items-center justify-center py-8'>
              <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
            </div>
          ) : (
            <div className='divide-y'>
              {canGoUp && (
                <button
                  type='button'
                  onClick={goUp}
                  className='flex items-center gap-2.5 w-full px-3 py-2 hover:bg-muted/50 text-left transition-colors'
                >
                  <ArrowUp className='h-4 w-4 text-muted-foreground shrink-0' />
                  <span className='text-sm font-medium'>..</span>
                </button>
              )}
              {folders.length === 0 && !canGoUp && (
                <div className='px-3 py-8 text-center text-sm text-muted-foreground'>
                  No subfolders
                </div>
              )}
              {folders.map((folder) => (
                <button
                  key={folder.navPath}
                  type='button'
                  onClick={() => setBrowsePath(folder.navPath)}
                  className='flex items-center gap-2.5 w-full px-3 py-2 hover:bg-muted/50 text-left transition-colors'
                >
                  <Folder className='h-4 w-4 text-muted-foreground shrink-0' />
                  <span className='text-sm truncate'>{folder.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className='rounded-md bg-destructive/10 border border-destructive/50 px-3 py-2 text-sm text-destructive'>
            {error.message}
          </div>
        )}

        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => onMove(browsePath)} disabled={isSameAsSource || isPending}>
            {isPending ? (isCopy ? 'Copying...' : 'Moving...') : isCopy ? 'Copy here' : 'Move here'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
