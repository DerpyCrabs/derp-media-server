import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { FileItem, MediaType } from '@/lib/types'
import { isPathEditable } from '@/lib/utils'
import { Star, Eye, Link, FilePlus, FolderPlus, AlertCircle } from 'lucide-react'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ShareLink } from '@/lib/shares'
import { FileListFileRow, FileListParentDirectoryRow } from '@/components/file-list-view-row'

const DEFAULT_EDITABLE_FOLDERS: string[] = []
const DEFAULT_SHARE_LINKS: ShareLink[] = []

interface FileListViewProps {
  files: FileItem[]
  currentPath: string
  playingPath: string | null
  onFileClick: (file: FileItem) => void
  onParentDirectory: () => void
  getIcon: (
    type: MediaType,
    filePath: string,
    isAudioFile?: boolean,
    isVideoFile?: boolean,
    isVirtual?: boolean,
  ) => React.ReactElement

  favorites?: string[]
  isVirtualFolder?: boolean
  editableFolders?: string[]
  shares?: ShareLink[]
  knowledgeBases?: string[]
  getViewCount?: (path: string) => number
  getShareViewCount?: (path: string) => number

  onFavoriteToggle?: (path: string, e: React.MouseEvent) => void
  onContextSetIcon?: (file: FileItem) => void
  onContextRename?: (file: FileItem) => void
  onContextDelete?: (file: FileItem) => void
  onContextDownload?: (file: FileItem) => void
  onContextToggleFavorite?: (file: FileItem) => void
  onContextToggleKnowledgeBase?: (file: FileItem) => void
  onContextShare?: (file: FileItem) => void
  onContextCopyShareLink?: (file: FileItem) => void
  onContextMove?: (file: FileItem) => void
  onContextCopy?: (file: FileItem) => void
  onContextOpenInNewTab?: (file: FileItem) => void
  onContextOpenInWorkspace?: (file: FileItem) => void
  onContextAddToTaskbar?: (file: FileItem) => void
  showOpenInNewTabForFiles?: boolean
  contextOpenWorkspaceAsStandalone?: boolean
  hasEditableFolders?: boolean
  onMoveFile?: (sourcePath: string, destinationDir: string) => void

  showDownloadButton?: boolean
  isEditable?: boolean
  dragSourceKind?: 'local' | 'share'
  dragSourceToken?: string

  /** When true, show inline New file / New folder row at bottom (KB + editable) */
  showInlineCreate?: boolean
  onInlineCreateFile?: (name: string) => void
  onInlineCreateFolder?: (name: string) => void
  createFilePending?: boolean
  createFolderPending?: boolean
  createFileError?: Error | null
  createFolderError?: Error | null
  onInlineCreateCancel?: () => void
}

export function FileListView({
  files,
  currentPath,
  playingPath,
  onFileClick,
  onParentDirectory,
  getIcon,
  favorites = [],
  isVirtualFolder = false,
  editableFolders = DEFAULT_EDITABLE_FOLDERS,
  shares = DEFAULT_SHARE_LINKS,
  knowledgeBases = [],
  getViewCount,
  getShareViewCount,
  onFavoriteToggle,
  onContextSetIcon,
  onContextRename,
  onContextDelete,
  onContextDownload,
  onContextToggleFavorite,
  onContextToggleKnowledgeBase,
  onContextShare,
  onContextCopyShareLink,
  onContextMove,
  onContextCopy,
  onContextOpenInNewTab,
  onContextOpenInWorkspace,
  onContextAddToTaskbar,
  showOpenInNewTabForFiles = false,
  contextOpenWorkspaceAsStandalone = false,
  hasEditableFolders = false,
  onMoveFile,
  showDownloadButton = false,
  isEditable: isEditableProp,
  dragSourceKind,
  dragSourceToken,
  showInlineCreate = false,
  onInlineCreateFile,
  onInlineCreateFolder,
  createFilePending = false,
  createFolderPending = false,
  createFileError = null,
  createFolderError = null,
  onInlineCreateCancel,
}: FileListViewProps) {
  const [inlineMode, setInlineMode] = useState<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [enableDrag] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(hover: hover)').matches : false,
  )

  const showFavorites = !!onFavoriteToggle
  const showViewCounts = !!getViewCount
  const showShareIndicators = shares.length > 0

  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const sharedPathSet = useMemo(
    () => (showShareIndicators ? new Set(shares.map((s) => s.path)) : new Set<string>()),
    [shares, showShareIndicators],
  )

  const parentParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : []
  const parentDir = parentParts.slice(0, -1).join('/')
  const canDropOnParent =
    !!onMoveFile && !!currentPath && isPathEditable(parentDir || '', editableFolders)

  const canDropOn = useCallback(
    (targetPath: string, sourcePath?: string) => {
      const src = sourcePath ?? draggedPath
      if (!src || src === targetPath) return false
      if (targetPath.startsWith(src + '/')) return false
      return true
    },
    [draggedPath],
  )

  useEffect(() => {
    if (inlineMode === 'file') fileInputRef.current?.focus()
    else if (inlineMode === 'folder') folderInputRef.current?.focus()
  }, [inlineMode])

  const inlineFolderExists =
    inlineMode === 'folder' &&
    !!inlineName.trim() &&
    files.some((f) => f.isDirectory && f.name.toLowerCase() === inlineName.trim().toLowerCase())
  const inlineFileExists =
    inlineMode === 'file' &&
    !!inlineName.trim() &&
    files.some((f) => {
      const fileName = inlineName.includes('.') ? inlineName.trim() : `${inlineName.trim()}.txt`
      return !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase()
    })

  const handleInlineCreateFile = useCallback(() => {
    const name = inlineName.trim()
    if (!name || inlineFileExists || !onInlineCreateFile) return
    onInlineCreateFile(name)
    setInlineMode(null)
    setInlineName('')
  }, [inlineName, inlineFileExists, onInlineCreateFile])

  const handleInlineCreateFolder = useCallback(() => {
    const name = inlineName.trim()
    if (!name || inlineFolderExists || !onInlineCreateFolder) return
    onInlineCreateFolder(name)
    setInlineMode(null)
    setInlineName('')
  }, [inlineName, inlineFolderExists, onInlineCreateFolder])

  const handleInlineNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setInlineName(e.target.value)
  }, [])

  const handleInlineFileKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleInlineCreateFile()
      else if (e.key === 'Escape') {
        setInlineMode(null)
        setInlineName('')
      }
    },
    [handleInlineCreateFile],
  )

  const handleInlineFileBlur = useCallback(() => {
    setInlineMode(null)
    setInlineName('')
    onInlineCreateCancel?.()
  }, [onInlineCreateCancel])

  const handleInlineFolderKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleInlineCreateFolder()
      else if (e.key === 'Escape') {
        setInlineMode(null)
        setInlineName('')
      }
    },
    [handleInlineCreateFolder],
  )

  const handleInlineFolderBlur = useCallback(() => {
    setInlineMode(null)
    setInlineName('')
    onInlineCreateCancel?.()
  }, [onInlineCreateCancel])

  const handleInlineTableRowClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
  }, [])

  const handleInputStopPropagation = useCallback((e: MouseEvent) => {
    e.stopPropagation()
  }, [])

  const handleStartInlineFile = useCallback(() => {
    setInlineMode('file')
    setInlineName('')
  }, [])

  const handleStartInlineFolder = useCallback(() => {
    setInlineMode('folder')
    setInlineName('')
  }, [])

  if (files.length === 0 && !currentPath) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <div className='h-12 w-12 mx-auto mb-4 opacity-50'>
          {getIcon(MediaType.FOLDER, '', false, false, false)}
        </div>
        <p>No media files found in this directory</p>
      </div>
    )
  }

  if (files.length === 0 && currentPath === VIRTUAL_FOLDERS.MOST_PLAYED) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <Eye className='h-12 w-12 mx-auto mb-4 opacity-50' />
        <p>No played files yet</p>
        <p className='text-xs mt-2'>Files you play will appear here</p>
      </div>
    )
  }

  if (files.length === 0 && currentPath === VIRTUAL_FOLDERS.FAVORITES) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <Star className='h-12 w-12 mx-auto mb-4 opacity-50' />
        <p>No favorites yet</p>
        <p className='text-xs mt-2'>Star files to add them to your favorites</p>
      </div>
    )
  }

  if (files.length === 0 && currentPath === VIRTUAL_FOLDERS.SHARES) {
    return (
      <div className='text-center py-12 text-muted-foreground'>
        <Link className='h-12 w-12 mx-auto mb-4 opacity-50' />
        <p>No active shares</p>
        <p className='text-xs mt-2'>
          Right-click a file or folder and select Share to create a link
        </p>
      </div>
    )
  }

  const hasAnyContextAction =
    onContextRename ||
    onContextDelete ||
    onContextDownload ||
    onContextMove ||
    onContextCopy ||
    onContextSetIcon ||
    onContextToggleFavorite ||
    onContextShare ||
    onContextOpenInNewTab ||
    onContextOpenInWorkspace ||
    onContextAddToTaskbar ||
    onContextToggleKnowledgeBase ||
    onContextCopyShareLink

  return (
    <div className='sm:px-4 py-2'>
      <Table>
        <TableBody>
          {currentPath && (
            <FileListParentDirectoryRow
              dragOverPath={dragOverPath}
              canDropOnParent={canDropOnParent}
              draggedPath={draggedPath}
              parentDir={parentDir}
              onMoveFile={onMoveFile}
              dragSourceKind={dragSourceKind}
              dragSourceToken={dragSourceToken}
              canDropOn={canDropOn}
              onParentDirectory={onParentDirectory}
              setDragOverPath={setDragOverPath}
            />
          )}
          {files.map((file) => {
            const isFavorite = favoriteSet.has(file.path)
            const isKnowledgeBase = file.isDirectory && knowledgeBases.includes(file.path)
            const viewCount = getViewCount?.(file.path) ?? 0
            const shareViewCount = getShareViewCount?.(file.path) ?? 0
            const isFileEditable =
              isEditableProp !== undefined
                ? isEditableProp
                : isPathEditable(file.path, editableFolders)
            const isShared = sharedPathSet.has(file.path)

            return (
              <FileListFileRow
                key={file.shareToken ? `share-${file.shareToken}` : file.path}
                file={file}
                playingPath={playingPath}
                draggedPath={draggedPath}
                dragOverPath={dragOverPath}
                enableDrag={enableDrag}
                isFileEditable={isFileEditable}
                onMoveFile={onMoveFile}
                dragSourceKind={dragSourceKind}
                dragSourceToken={dragSourceToken}
                onFileClick={onFileClick}
                getIcon={getIcon}
                editableFolders={editableFolders}
                isEditableProp={isEditableProp}
                canDropOn={canDropOn}
                setDraggedPath={setDraggedPath}
                setDragOverPath={setDragOverPath}
                isFavorite={isFavorite}
                isKnowledgeBase={isKnowledgeBase}
                viewCount={viewCount}
                shareViewCount={shareViewCount}
                isShared={isShared}
                showFavorites={showFavorites}
                showViewCounts={showViewCounts}
                showDownloadButton={showDownloadButton}
                onFavoriteToggle={onFavoriteToggle}
                onContextDownload={onContextDownload}
                isVirtualFolder={isVirtualFolder}
                hasAnyContextAction={!!hasAnyContextAction}
                onContextSetIcon={onContextSetIcon}
                onContextRename={onContextRename}
                onContextDelete={onContextDelete}
                onContextToggleFavorite={onContextToggleFavorite}
                onContextToggleKnowledgeBase={onContextToggleKnowledgeBase}
                onContextShare={onContextShare}
                onContextCopyShareLink={onContextCopyShareLink}
                onContextMove={onContextMove}
                onContextCopy={onContextCopy}
                onContextOpenInNewTab={onContextOpenInNewTab}
                onContextOpenInWorkspace={onContextOpenInWorkspace}
                onContextAddToTaskbar={onContextAddToTaskbar}
                showOpenInNewTabForFiles={showOpenInNewTabForFiles}
                contextOpenWorkspaceAsStandalone={contextOpenWorkspaceAsStandalone}
                hasEditableFolders={hasEditableFolders}
              />
            )
          })}
          {showInlineCreate && (
            <TableRow
              className='border-t bg-muted/20 hover:bg-muted/30'
              onClick={handleInlineTableRowClick}
            >
              <TableCell colSpan={3} className='p-0'>
                <div className='grid grid-cols-2 gap-px p-2'>
                  <div className='w-full min-w-0 flex flex-col gap-1'>
                    {inlineMode === 'file' ? (
                      <>
                        <Input
                          ref={fileInputRef}
                          value={inlineName}
                          onChange={handleInlineNameChange}
                          placeholder='File name (e.g. notes.md)'
                          onKeyDown={handleInlineFileKeyDown}
                          onBlur={handleInlineFileBlur}
                          disabled={createFilePending}
                          className={`h-8 text-sm ${
                            inlineFileExists
                              ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                              : createFileError
                                ? 'border-destructive ring-2 ring-destructive/30'
                                : ''
                          }`}
                          onClick={handleInputStopPropagation}
                        />
                        {inlineFileExists && (
                          <div className='flex items-start gap-1.5 rounded bg-yellow-500/10 border border-yellow-500/50 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>A file with this name already exists.</span>
                          </div>
                        )}
                        {createFileError && !inlineFileExists && (
                          <div className='flex items-start gap-1.5 rounded bg-destructive/10 border border-destructive/50 px-2 py-1.5 text-xs text-destructive'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>{createFileError.message}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <button
                        type='button'
                        onClick={handleStartInlineFile}
                        className='flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground transition-colors'
                      >
                        <FilePlus className='h-4 w-4' />
                        New file
                      </button>
                    )}
                  </div>
                  <div className='w-full min-w-0 flex flex-col gap-1'>
                    {inlineMode === 'folder' ? (
                      <>
                        <Input
                          ref={folderInputRef}
                          value={inlineName}
                          onChange={handleInlineNameChange}
                          placeholder='Folder name'
                          onKeyDown={handleInlineFolderKeyDown}
                          onBlur={handleInlineFolderBlur}
                          disabled={createFolderPending}
                          className={`h-8 text-sm ${
                            inlineFolderExists
                              ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                              : createFolderError
                                ? 'border-destructive ring-2 ring-destructive/30'
                                : ''
                          }`}
                          onClick={handleInputStopPropagation}
                        />
                        {inlineFolderExists && (
                          <div className='flex items-start gap-1.5 rounded bg-yellow-500/10 border border-yellow-500/50 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>A folder with this name already exists.</span>
                          </div>
                        )}
                        {createFolderError && !inlineFolderExists && (
                          <div className='flex items-start gap-1.5 rounded bg-destructive/10 border border-destructive/50 px-2 py-1.5 text-xs text-destructive'>
                            <AlertCircle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
                            <span>{createFolderError.message}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <button
                        type='button'
                        onClick={handleStartInlineFolder}
                        className='flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground transition-colors'
                      >
                        <FolderPlus className='h-4 w-4' />
                        New folder
                      </button>
                    )}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
