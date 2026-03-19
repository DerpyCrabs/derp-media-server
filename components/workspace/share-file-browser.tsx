import { Suspense, useState, useMemo, useCallback, useEffect } from 'react'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import { api, post } from '@/lib/api'
import { FileItem } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { FolderPlus, FilePlus, ChevronRight, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFileIcon } from '@/lib/use-file-icon'
import { useMediaPlayer } from '@/lib/use-media-player'
import {
  CreateFolderDialog,
  CreateFileDialog,
  RenameDialog,
  DeleteConfirmDialog,
} from '@/components/file-dialogs'
import { MoveToDialog } from '@/components/move-to-dialog'
import { FileListView } from '@/components/file-list-view'
import { FileGridView } from '@/components/file-grid-view'
import { KbSearchResults } from '@/components/kb-search-results'
import { KbDashboard } from '@/components/kb-dashboard'
import { useUpload } from '@/lib/use-upload'
import { UploadDropZone } from '@/components/upload-drop-zone'
import { UploadProgress } from '@/components/upload-progress'
import { UploadMenuButton } from '@/components/upload-menu-button'
import { useFiles } from '@/lib/use-files'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useNavigationSession } from '@/lib/use-navigation-session'
import { useShareFileWatcher } from '@/lib/use-share-file-watcher'
import { BrowserPane } from '@/components/browser-pane'
import { BrowserPaneContent } from '@/components/browser-pane-content'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { queryKeys } from '@/lib/query-keys'
import { useShareWorkspace } from '@/lib/share-workspace-context'

interface ShareFileBrowserProps {
  session: NavigationSession
  dialogContainerRef?: React.RefObject<HTMLElement | null>
  onOpenInNewTabInSameWindow?: (file: FileItem) => void
  onAddToTaskbar?: (file: FileItem) => void
}

function ShareFileBrowserInner({
  session: sessionProp,
  dialogContainerRef,
  onOpenInNewTabInSameWindow,
  onAddToTaskbar,
}: ShareFileBrowserProps) {
  const shareCtx = useShareWorkspace()
  if (!shareCtx) throw new Error('ShareFileBrowser requires ShareWorkspaceContext')

  const {
    token,
    path: sharePath,
    name: shareName,
    editable,
    restrictions,
    isKnowledgeBase,
  } = shareCtx

  const session = useNavigationSession(sessionProp)
  const { state, navigateToFolder, viewFile, playFile: urlPlayFile } = session
  const queryClient = useQueryClient()
  useShareFileWatcher(token)

  const currentSubDir = state.dir || ''
  const playingPath = state.playing
  const mediaContext: SourceContext = useMemo(
    () => ({ shareToken: token, sharePath }),
    [token, sharePath],
  )

  const canUpload = editable && restrictions?.allowUpload !== false
  const canEdit = editable && restrictions?.allowEdit !== false
  const canDelete = editable && restrictions?.allowDelete !== false
  const inKb = isKnowledgeBase

  const startPlayback = useMediaPlayer((s) => s.playFile)
  const {
    currentFile,
    mediaType,
    isPlaying: mediaPlayerIsPlaying,
  } = useMediaPlayer(
    useShallow((s) => ({
      currentFile: s.currentFile,
      mediaType: s.mediaType,
      isPlaying: s.isPlaying,
    })),
  )

  const { getIcon } = useFileIcon({
    customIcons: {},
    playingPath,
    currentFile,
    mediaPlayerIsPlaying,
    mediaType,
  })

  const stripSharePrefixFn = useCallback(
    (filePath: string) => {
      const norm = sharePath.replace(/\\/g, '/')
      const fwd = filePath.replace(/\\/g, '/')
      return fwd.startsWith(norm + '/') ? fwd.slice(norm.length + 1) : fwd
    },
    [sharePath],
  )

  const currentPath = useMemo(() => {
    const norm = sharePath.replace(/\\/g, '/')
    return currentSubDir ? `${norm}/${currentSubDir}` : norm
  }, [sharePath, currentSubDir])

  const { data: filesData = [] } = useFiles(currentPath, mediaContext)
  const files = useMemo(() => filesData as FileItem[], [filesData])

  const {
    uploadFiles,
    isUploading,
    error: uploadError,
    fileCount: uploadFileCount,
    reset: resetUpload,
  } = useUpload({ shareToken: token })

  const handleUploadFiles = useCallback(
    (uploadedFiles: File[]) => {
      uploadFiles(uploadedFiles, currentSubDir)
    },
    [uploadFiles, currentSubDir],
  )

  const createFolderMutation = useMutation({
    mutationFn: (vars: { token: string; type: string; path: string; content?: string }) =>
      post(`/api/share/${vars.token}/create`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) }),
  })

  const createFileMutation = useMutation({
    mutationFn: (vars: { token: string; type: string; path: string; content?: string }) =>
      post(`/api/share/${vars.token}/create`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) }),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (vars: { token: string; path: string }) =>
      post(`/api/share/${vars.token}/delete`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) }),
  })

  const renameMutation = useMutation({
    mutationFn: (vars: { token: string; oldPath: string; newPath: string }) =>
      post(`/api/share/${vars.token}/rename`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) }),
  })

  const moveMutation = useMutation({
    mutationFn: (vars: { token: string; oldPath: string; newPath: string }) =>
      post(`/api/share/${vars.token}/rename`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) }),
  })

  const viewMutation = useMutation({
    mutationFn: (vars: { token: string; filePath?: string }) =>
      post(`/api/share/${vars.token}/view`, vars),
  })

  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingItem, setDeletingItem] = useState<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<FileItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const debouncedSearchValue = useDebouncedValue(searchQuery, 300)
  const debouncedSearchQuery = !searchQuery.trim() || !inKb ? '' : debouncedSearchValue

  useEffect(() => {
    setSearchQuery('')
  }, [currentPath])

  const { data: kbSearchData, isLoading: searchLoading } = useQuery({
    queryKey: queryKeys.shareKbSearch(token, debouncedSearchQuery, currentSubDir),
    queryFn: () => {
      const params = new URLSearchParams({ q: debouncedSearchQuery })
      if (currentSubDir) params.set('dir', currentSubDir)
      return api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/share/${token}/kb/search?${params}`,
      )
    },
    enabled: !!debouncedSearchQuery.trim() && inKb,
  })
  const searchResults = (kbSearchData?.results || []) as {
    path: string
    name: string
    snippet: string
  }[]

  const renameTargetExists = useMemo(() => {
    if (!renameNewName.trim() || !renamingItem) return false
    if (renameMutation.isPending) return false
    return files.some(
      (f) => f.path !== renamingItem.path && f.name.toLowerCase() === renameNewName.toLowerCase(),
    )
  }, [renameNewName, files, renamingItem, renameMutation.isPending])

  const folderExists = useMemo(() => {
    if (!newItemName.trim()) return false
    return files.some((f) => f.isDirectory && f.name.toLowerCase() === newItemName.toLowerCase())
  }, [newItemName, files])

  const fileExists = useMemo(() => {
    if (!newItemName.trim()) return false
    const defaultExt = inKb ? '.md' : '.txt'
    const fileName = newItemName.includes('.') ? newItemName : `${newItemName}${defaultExt}`
    return files.some((f) => !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase())
  }, [newItemName, files, inKb])

  const navigate = useCallback(
    (subDir: string) => navigateToFolder(subDir || null),
    [navigateToFolder],
  )

  const trackShareView = useCallback(
    (filePath: string) => {
      viewMutation.mutate({ token, filePath: stripSharePrefixFn(filePath) })
    },
    [token, stripSharePrefixFn, viewMutation],
  )

  const handleFileClick = useCallback(
    (file: FileItem) => {
      if (file.isDirectory) {
        navigate(stripSharePrefixFn(file.path))
      } else {
        trackShareView(file.path)
        const ext = file.path.split('.').pop()?.toLowerCase() || ''
        const type = getMediaType(ext)
        const isMedia = type === 'audio' || type === 'video'
        if (isMedia) {
          startPlayback(file.path, type === 'audio' ? 'audio' : 'video')
          urlPlayFile(file.path, currentSubDir)
        } else {
          viewFile(file.path, currentSubDir)
        }
      }
    },
    [
      stripSharePrefixFn,
      navigate,
      urlPlayFile,
      viewFile,
      trackShareView,
      startPlayback,
      currentSubDir,
    ],
  )

  const handleParentDirectory = useCallback(() => {
    if (!currentSubDir) return
    const parts = currentSubDir.split('/').filter(Boolean)
    if (parts.length <= 1) {
      navigate('')
    } else {
      navigate(parts.slice(0, -1).join('/'))
    }
  }, [currentSubDir, navigate])

  const handleDownload = useCallback(
    (file: FileItem) => {
      const a = document.createElement('a')
      a.href = `/api/share/${token}/download?path=${encodeURIComponent(stripSharePrefixFn(file.path))}`
      a.download = file.name
      a.click()
    },
    [token, stripSharePrefixFn],
  )

  const handleOpenInNewTab = useCallback(
    (file: FileItem) => {
      if (file.isVirtual) return
      if (onOpenInNewTabInSameWindow) {
        onOpenInNewTabInSameWindow(file)
        return
      }
      if (!file.isDirectory) return
      const subPath = stripSharePrefixFn(file.path)
      const params = new URLSearchParams()
      if (subPath) params.set('dir', subPath)
      const query = params.toString()
      const url = query ? `/share/${token}/workspace?${query}` : `/share/${token}/workspace`
      window.open(url, '_blank')
    },
    [token, stripSharePrefixFn, onOpenInNewTabInSameWindow],
  )

  const handleContextRename = useCallback((file: FileItem) => {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRenameDialog(true)
  }, [])

  const handleContextDelete = useCallback((file: FileItem) => {
    setDeletingItem(file)
    setShowDeleteDialog(true)
  }, [])

  const handleMoveFile = useCallback(
    (sourceFullPath: string, destDir: string) => {
      const sourceRelative = stripSharePrefixFn(sourceFullPath)
      const fileName = sourceRelative.split('/').pop()!
      const destRelative = stripSharePrefixFn(destDir)
      const newPath = destRelative ? `${destRelative}/${fileName}` : fileName
      moveMutation.mutate({ token, oldPath: sourceRelative, newPath })
    },
    [stripSharePrefixFn, moveMutation, token],
  )

  const handleContextMoveFile = useCallback(
    (file: FileItem) => {
      setMoveTarget(file)
      moveMutation.reset()
      setShowMoveDialog(true)
    },
    [moveMutation],
  )

  const handleDialogMove = useCallback(
    (destDir: string) => {
      if (!moveTarget) return
      const sourceRelative = stripSharePrefixFn(moveTarget.path)
      const fileName = sourceRelative.split('/').pop()!
      const newPath = destDir ? `${destDir}/${fileName}` : fileName
      moveMutation.mutate(
        { token, oldPath: sourceRelative, newPath },
        {
          onSuccess: () => {
            setShowMoveDialog(false)
            setMoveTarget(null)
            moveMutation.reset()
          },
        },
      )
    },
    [moveTarget, stripSharePrefixFn, moveMutation, token],
  )

  const handleKbResultClick = useCallback(
    (filePath: string) => {
      setSearchQuery('')
      viewFile(filePath, currentSubDir)
    },
    [viewFile, currentSubDir],
  )

  const handleInlineCreateFile = useCallback(
    (name: string) => {
      const defaultExt = inKb ? '.md' : '.txt'
      const fileName = name.includes('.') ? name : `${name}${defaultExt}`
      const subPath = currentSubDir ? `${currentSubDir}/${fileName}` : fileName
      const sharePathNorm = sharePath.replace(/\\/g, '/')
      const fullPath = sharePathNorm ? `${sharePathNorm}/${subPath}` : subPath
      createFileMutation.mutate(
        { token, type: 'file', path: subPath, content: '' },
        {
          onSuccess: () => {
            createFileMutation.reset()
            if (inKb) viewFile(fullPath, currentSubDir)
          },
        },
      )
    },
    [token, currentSubDir, sharePath, inKb, createFileMutation, viewFile],
  )

  const handleInlineCreateFolder = useCallback(
    (name: string) => {
      const subPath = currentSubDir ? `${currentSubDir}/${name}` : name
      createFolderMutation.mutate(
        { token, type: 'folder', path: subPath },
        { onSuccess: () => createFolderMutation.reset() },
      )
    },
    [token, currentSubDir, createFolderMutation],
  )

  const breadcrumbs = useMemo(() => {
    const parts = currentSubDir ? currentSubDir.split('/').filter(Boolean) : []
    return [
      { name: shareName, path: '' },
      ...parts.map((part, i) => ({
        name: part,
        path: parts.slice(0, i + 1).join('/'),
      })),
    ]
  }, [currentSubDir, shareName])

  const dialogContainer = dialogContainerRef?.current ?? undefined

  const dialogs = (
    <>
      <MoveToDialog
        isOpen={showMoveDialog}
        container={dialogContainer}
        onClose={() => {
          setShowMoveDialog(false)
          setMoveTarget(null)
          moveMutation.reset()
        }}
        fileName={moveTarget?.name || ''}
        filePath={moveTarget ? stripSharePrefixFn(moveTarget.path) : ''}
        onMove={handleDialogMove}
        isPending={moveMutation.isPending}
        error={moveMutation.error as Error | null}
        shareToken={token}
        shareRootPath={sharePath}
      />

      <CreateFolderDialog
        isOpen={showCreateFolder}
        container={dialogContainer}
        onOpenChange={setShowCreateFolder}
        folderName={newItemName}
        onFolderNameChange={setNewItemName}
        onCreateFolder={() => {
          const subPath = currentSubDir ? `${currentSubDir}/${newItemName}` : newItemName
          createFolderMutation.mutate(
            { token, type: 'folder', path: subPath },
            {
              onSuccess: () => {
                setShowCreateFolder(false)
                setNewItemName('')
                createFolderMutation.reset()
              },
            },
          )
        }}
        isPending={createFolderMutation.isPending}
        error={createFolderMutation.error}
        folderExists={folderExists}
        onReset={() => {
          setShowCreateFolder(false)
          setNewItemName('')
          createFolderMutation.reset()
        }}
      />

      <CreateFileDialog
        isOpen={showCreateFile}
        container={dialogContainer}
        onOpenChange={setShowCreateFile}
        fileName={newItemName}
        onFileNameChange={setNewItemName}
        defaultExtension={inKb ? 'md' : 'txt'}
        onCreateFile={() => {
          const defaultExt = inKb ? '.md' : '.txt'
          const fileName = newItemName.includes('.') ? newItemName : `${newItemName}${defaultExt}`
          const subPath = currentSubDir ? `${currentSubDir}/${fileName}` : fileName
          const sharePathNorm = sharePath.replace(/\\/g, '/')
          const fullPath = sharePathNorm ? `${sharePathNorm}/${subPath}` : subPath
          createFileMutation.mutate(
            { token, type: 'file', path: subPath, content: '' },
            {
              onSuccess: () => {
                setShowCreateFile(false)
                setNewItemName('')
                createFileMutation.reset()
                if (inKb) viewFile(fullPath, currentSubDir)
              },
            },
          )
        }}
        isPending={createFileMutation.isPending}
        error={createFileMutation.error}
        fileExists={fileExists}
        onReset={() => {
          setShowCreateFile(false)
          setNewItemName('')
          createFileMutation.reset()
        }}
      />

      <RenameDialog
        isOpen={showRenameDialog}
        container={dialogContainer}
        onOpenChange={setShowRenameDialog}
        itemName={renamingItem?.name || ''}
        newName={renameNewName}
        onNewNameChange={setRenameNewName}
        onRename={() => {
          if (renamingItem) {
            const relativeOld = stripSharePrefixFn(renamingItem.path)
            const parts = relativeOld.split('/').filter(Boolean)
            const parentPath = parts.slice(0, -1).join('/')
            const relativeNew = parentPath ? `${parentPath}/${renameNewName}` : renameNewName
            renameMutation.mutate(
              { token, oldPath: relativeOld, newPath: relativeNew },
              {
                onSuccess: () => {
                  setShowRenameDialog(false)
                  setRenamingItem(null)
                  setRenameNewName('')
                  renameMutation.reset()
                },
              },
            )
          }
        }}
        isPending={renameMutation.isPending}
        error={renameMutation.error as Error | null}
        nameExists={renameTargetExists}
        isDirectory={renamingItem?.isDirectory || false}
        onReset={() => {
          setShowRenameDialog(false)
          setRenamingItem(null)
          setRenameNewName('')
          renameMutation.reset()
        }}
      />

      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        container={dialogContainer}
        onOpenChange={setShowDeleteDialog}
        item={deletingItem}
        onDelete={() => {
          if (deletingItem) {
            deleteItemMutation.mutate(
              { token, path: stripSharePrefixFn(deletingItem.path) },
              {
                onSuccess: () => {
                  setShowDeleteDialog(false)
                  setDeletingItem(null)
                  deleteItemMutation.reset()
                },
              },
            )
          }
        }}
        isPending={deleteItemMutation.isPending}
        error={deleteItemMutation.error as Error | null}
        onReset={() => {
          setShowDeleteDialog(false)
          setDeletingItem(null)
          deleteItemMutation.reset()
        }}
      />
    </>
  )

  const toolbarActions = canUpload ? (
    <>
      <Button
        variant='outline'
        size='icon'
        onClick={() => {
          setNewItemName('')
          createFolderMutation.reset()
          setShowCreateFolder(true)
        }}
        title='Create new folder'
        className='h-7 w-7'
      >
        <FolderPlus className='h-3.5 w-3.5' />
      </Button>
      <Button
        variant='outline'
        size='icon'
        onClick={() => {
          setNewItemName('')
          createFileMutation.reset()
          setShowCreateFile(true)
        }}
        title='Create new file'
        className='h-7 w-7'
      >
        <FilePlus className='h-3.5 w-3.5' />
      </Button>
      <UploadMenuButton mode='Workspace' disabled={isUploading} onUpload={handleUploadFiles} />
      <div className='w-px h-5 bg-border mx-1' />
    </>
  ) : null

  const listView = (
    <FileListView
      files={files}
      currentPath={currentSubDir}
      playingPath={playingPath}
      onFileClick={handleFileClick}
      onParentDirectory={handleParentDirectory}
      getIcon={getIcon}
      isEditable={canEdit}
      onMoveFile={canEdit ? handleMoveFile : undefined}
      showDownloadButton
      onContextDownload={handleDownload}
      onContextRename={canEdit ? handleContextRename : undefined}
      onContextDelete={canDelete ? handleContextDelete : undefined}
      onContextMove={canEdit ? handleContextMoveFile : undefined}
      onContextOpenInNewTab={handleOpenInNewTab}
      onContextAddToTaskbar={onAddToTaskbar}
      showOpenInNewTabForFiles={!!onOpenInNewTabInSameWindow}
      dragSourceKind='share'
      dragSourceToken={token}
      showInlineCreate={inKb && canUpload}
      onInlineCreateFile={handleInlineCreateFile}
      onInlineCreateFolder={handleInlineCreateFolder}
      onInlineCreateCancel={() => {
        createFileMutation.reset()
        createFolderMutation.reset()
      }}
      createFilePending={createFileMutation.isPending}
      createFolderPending={createFolderMutation.isPending}
      createFileError={createFileMutation.error as Error | null}
      createFolderError={createFolderMutation.error as Error | null}
    />
  )

  const gridView = (
    <FileGridView
      files={files}
      currentPath={currentSubDir}
      playingPath={playingPath}
      onFileClick={handleFileClick}
      onParentDirectory={handleParentDirectory}
      getIcon={getIcon}
      isEditable={canEdit}
      onMoveFile={canEdit ? handleMoveFile : undefined}
      onContextDownload={handleDownload}
      onContextRename={canEdit ? handleContextRename : undefined}
      onContextDelete={canDelete ? handleContextDelete : undefined}
      onContextMove={canEdit ? handleContextMoveFile : undefined}
      onContextOpenInNewTab={handleOpenInNewTab}
      onContextAddToTaskbar={onAddToTaskbar}
      showOpenInNewTabForFiles={!!onOpenInNewTabInSameWindow}
      dragSourceKind='share'
      dragSourceToken={token}
    />
  )

  const storageKey = `share-workspace-viewmode-${token}`
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey)
      if (saved === 'list' || saved === 'grid') return saved
    }
    return 'list'
  })
  const handleViewModeChange = useCallback(
    (mode: 'list' | 'grid') => {
      setViewMode(mode)
      try {
        localStorage.setItem(storageKey, mode)
      } catch {}
    },
    [storageKey],
  )

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden'>
      <BrowserPane
        mode='Workspace'
        dialogs={dialogs}
        progress={
          <UploadProgress
            isUploading={isUploading}
            error={uploadError}
            fileCount={uploadFileCount}
            onDismiss={resetUpload}
          />
        }
        breadcrumbs={
          <div className='flex items-center gap-1 flex-wrap min-w-0 flex-1'>
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.path} className='flex items-center gap-1'>
                {index > 0 && <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />}
                <Button
                  variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
                  size='sm'
                  onClick={() => navigate(crumb.path)}
                  className='gap-1.5 text-xs h-7 px-2'
                >
                  {index === 0 && <Folder className='h-3.5 w-3.5' />}
                  {crumb.name}
                </Button>
              </div>
            ))}
          </div>
        }
        search={{
          visible: inKb,
          placeholder: 'Search notes...',
          value: searchQuery,
          onChange: setSearchQuery,
        }}
        actions={toolbarActions}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      >
        <UploadDropZone
          enabled={canUpload}
          onUpload={handleUploadFiles}
          className='min-h-0 flex-1 overflow-hidden'
        >
          <ScrollArea className='size-full'>
            <BrowserPaneContent
              searchQuery={searchQuery}
              searchResults={
                <KbSearchResults
                  results={searchResults}
                  query={searchQuery}
                  isLoading={searchLoading}
                  currentPath={currentPath}
                  onResultClick={handleKbResultClick}
                />
              }
              dashboard={
                inKb && currentPath ? (
                  <KbDashboard
                    scopePath={sharePath}
                    onFileClick={handleKbResultClick}
                    shareToken={token}
                    dir={currentSubDir || undefined}
                  />
                ) : null
              }
              viewMode={viewMode}
              listView={listView}
              gridView={gridView}
            />
          </ScrollArea>
        </UploadDropZone>
      </BrowserPane>
    </div>
  )
}

export function ShareFileBrowser(props: ShareFileBrowserProps) {
  return (
    <Suspense fallback={<div className='flex items-center justify-center h-full'>Loading...</div>}>
      <ShareFileBrowserInner {...props} />
    </Suspense>
  )
}
