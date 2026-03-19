import { Suspense, useState, useMemo, useCallback } from 'react'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { api, post } from '@/lib/api'
import { FileItem, MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { MediaPlayers } from '@/components/media-players'
import { FolderPlus, FilePlus, ChevronRight, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useFileIcon } from '@/lib/use-file-icon'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { FileContextMenu } from '@/components/file-context-menu'
import { RenameDialog, DeleteConfirmDialog } from '@/components/file-dialogs'
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
import { ThemeSwitcher } from '@/components/theme-switcher'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { queryKeys } from '@/lib/query-keys'
import { useBrowserViewMode } from '@/lib/browser-view-mode-store'

interface ShareRestrictions {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

interface ShareInfo {
  token: string
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  restrictions?: ShareRestrictions
  isKnowledgeBase?: boolean
}

interface SharedFolderBrowserProps {
  token: string
  shareInfo: ShareInfo
  searchParams: { dir?: string; viewing?: string; playing?: string }
  adminViewMode?: 'list' | 'grid'
  session?: NavigationSession
}

export function SharedFolderBrowser(props: SharedFolderBrowserProps) {
  return (
    <Suspense
      fallback={<div className='flex items-center justify-center h-screen'>Loading...</div>}
    >
      <SharedFolderBrowserInner {...props} />
    </Suspense>
  )
}

function SharedFolderBrowserInner({
  token,
  shareInfo,
  adminViewMode = 'list',
  session: sessionProp,
}: SharedFolderBrowserProps) {
  const session = useNavigationSession(sessionProp)
  const { state, navigateToFolder, viewFile, playFile: urlPlayFile } = session
  const queryClient = useQueryClient()
  useShareFileWatcher(token)
  const currentSubDir = state.dir || ''
  const playingPath = state.playing
  const mediaContext: SourceContext = useMemo(
    () => ({ shareToken: token, sharePath: shareInfo.path }),
    [token, shareInfo.path],
  )

  useDynamicFavicon({}, { rootName: shareInfo.name, state })

  const canUpload = shareInfo.editable && shareInfo.restrictions?.allowUpload !== false
  const canEdit = shareInfo.editable && shareInfo.restrictions?.allowEdit !== false
  const canDelete = shareInfo.editable && shareInfo.restrictions?.allowDelete !== false

  const viewModeStorageKey = `share-viewmode-${token}`
  const { viewMode, setViewMode: handleViewModeChange } = useBrowserViewMode(
    viewModeStorageKey,
    adminViewMode,
  )
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState(false)
  const [newItemName, setNewItemName] = useState('')

  const {
    uploadFiles,
    isUploading,
    error: uploadError,
    fileCount: uploadFileCount,
    reset: resetUpload,
  } = useUpload({ shareToken: token })

  const handleUploadFiles = useCallback(
    (files: File[]) => {
      uploadFiles(files, currentSubDir)
    },
    [uploadFiles, currentSubDir],
  )

  const { getIcon } = useFileIcon({
    customIcons: {},
    playingPath,
    currentFile: null,
    mediaPlayerIsPlaying: false,
    mediaType: null,
  })

  const stripSharePrefix = useCallback(
    (filePath: string) => {
      const sharePath = shareInfo.path.replace(/\\/g, '/')
      const fwd = filePath.replace(/\\/g, '/')
      return fwd.startsWith(sharePath + '/') ? fwd.slice(sharePath.length + 1) : fwd
    },
    [shareInfo.path],
  )

  const encodePathForUrl = useCallback(
    (filePath: string) => {
      return stripSharePrefix(filePath).split('/').map(encodeURIComponent).join('/')
    },
    [stripSharePrefix],
  )

  const currentPath = useMemo(() => {
    const sharePathNorm = shareInfo.path.replace(/\\/g, '/')
    return currentSubDir ? `${sharePathNorm}/${currentSubDir}` : sharePathNorm
  }, [shareInfo.path, currentSubDir])

  const { data: filesData = [], isLoading } = useFiles(currentPath, mediaContext)
  const files = useMemo(() => filesData as FileItem[], [filesData])

  const createFolderMutation = useMutation({
    mutationFn: (vars: { token: string; type: string; path: string; content?: string }) =>
      post(`/api/share/${vars.token}/create`, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) })
      setShowCreateFolder(false)
      setNewItemName('')
    },
  })

  const inKb = shareInfo.isKnowledgeBase ?? false
  const createFileMutation = useMutation({
    mutationFn: (vars: { token: string; type: string; path: string; content?: string }) =>
      post(`/api/share/${vars.token}/create`, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) })
    },
  })

  const deleteItemMutation = useMutation({
    mutationFn: (vars: { token: string; path: string }) =>
      post(`/api/share/${vars.token}/delete`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) }),
  })

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchValue = useDebouncedValue(searchQuery, 300)
  const debouncedSearchQuery = !searchQuery.trim() || !inKb ? '' : debouncedSearchValue

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

  const handleKbResultClick = useCallback(
    (filePath: string) => {
      setSearchQuery('')
      viewFile(filePath)
    },
    [viewFile],
  )

  const viewMutation = useMutation({
    mutationFn: (vars: { token: string; filePath?: string }) =>
      post(`/api/share/${vars.token}/view`, vars),
  })

  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingItem, setDeletingItem] = useState<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<FileItem | null>(null)

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

  const handleMoveFile = useCallback(
    (sourceFullPath: string, destDir: string) => {
      const sourceRelative = stripSharePrefix(sourceFullPath)
      const fileName = sourceRelative.split('/').pop()!
      const destRelative = stripSharePrefix(destDir)
      const newPath = destRelative ? `${destRelative}/${fileName}` : fileName
      moveMutation.mutate({ token, oldPath: sourceRelative, newPath })
    },
    [stripSharePrefix, moveMutation, token],
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
      const sourceRelative = stripSharePrefix(moveTarget.path)
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
    [moveTarget, stripSharePrefix, moveMutation, token],
  )

  const renameTargetExists = useMemo(() => {
    if (!renameNewName.trim() || !renamingItem) return false
    if (renameMutation.isPending) return false
    return files.some(
      (f) => f.path !== renamingItem.path && f.name.toLowerCase() === renameNewName.toLowerCase(),
    )
  }, [renameNewName, files, renamingItem, renameMutation.isPending])

  const handleContextRename = useCallback((file: FileItem) => {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRenameDialog(true)
  }, [])

  const handleContextDelete = useCallback((file: FileItem) => {
    setDeletingItem(file)
    setShowDeleteDialog(true)
  }, [])

  const navigate = useCallback(
    (subDir: string) => {
      navigateToFolder(subDir || null)
    },
    [navigateToFolder],
  )

  const trackShareView = useCallback(
    (filePath: string) => {
      viewMutation.mutate({ token, filePath: stripSharePrefix(filePath) })
    },
    [token, stripSharePrefix, viewMutation],
  )

  const handleFileClick = useCallback(
    (file: FileItem) => {
      if (file.isDirectory) {
        navigate(stripSharePrefix(file.path))
      } else {
        trackShareView(file.path)
        const ext = file.path.split('.').pop()?.toLowerCase() || ''
        const type = getMediaType(ext)
        const isMedia = type === 'audio' || type === 'video'
        if (isMedia) {
          urlPlayFile(file.path)
        } else {
          viewFile(file.path)
        }
      }
    },
    [stripSharePrefix, navigate, urlPlayFile, viewFile, trackShareView],
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
      a.href = `/api/share/${token}/download?path=${encodeURIComponent(stripSharePrefix(file.path))}`
      a.download = file.name
      a.click()
    },
    [token, stripSharePrefix],
  )

  const handleOpenInNewTab = useCallback(
    (file: FileItem) => {
      if (!file.isDirectory || file.isVirtual) return
      const sharePathNorm = shareInfo.path.replace(/\\/g, '/')
      const pathNorm = file.path.replace(/\\/g, '/')
      const subPath = pathNorm === sharePathNorm ? '' : stripSharePrefix(file.path)
      const params = new URLSearchParams()
      if (subPath) params.set('dir', subPath)
      const query = params.toString()
      const url = query ? `/share/${token}?${query}` : `/share/${token}`
      window.open(url, '_blank')
    },
    [token, shareInfo.path, stripSharePrefix],
  )

  const handleOpenInWorkspace = useCallback(
    (file: FileItem) => {
      if (!file.isDirectory || file.isVirtual) return
      const sharePathNorm = shareInfo.path.replace(/\\/g, '/')
      const pathNorm = file.path.replace(/\\/g, '/')
      const subPath = pathNorm === sharePathNorm ? '' : stripSharePrefix(file.path)
      const params = new URLSearchParams()
      if (subPath) params.set('dir', subPath)
      const query = params.toString()
      window.open(
        query ? `/share/${token}/workspace?${query}` : `/share/${token}/workspace`,
        '_blank',
      )
    },
    [token, shareInfo.path, stripSharePrefix],
  )

  const getThumbnailUrl = useCallback(
    (file: FileItem) => `/api/share/${token}/thumbnail/${encodePathForUrl(file.path)}`,
    [token, encodePathForUrl],
  )

  const getImagePreviewUrl = useCallback(
    (file: FileItem) => `/api/share/${token}/media/${encodePathForUrl(file.path)}`,
    [token, encodePathForUrl],
  )

  const breadcrumbs = useMemo(() => {
    const parts = currentSubDir ? currentSubDir.split('/').filter(Boolean) : []
    return [
      { name: shareInfo.name, path: '' },
      ...parts.map((part, i) => ({
        name: part,
        path: parts.slice(0, i + 1).join('/'),
      })),
    ]
  }, [currentSubDir, shareInfo.name])

  const isAudioPlaying = useMemo(() => {
    if (!playingPath) return false
    const ext = playingPath.split('.').pop()?.toLowerCase() || ''
    const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
    return audioExtensions.includes(ext) || state.audioOnly
  }, [playingPath, state.audioOnly])

  const handleInlineCreateFile = useCallback(
    (name: string) => {
      const defaultExt = inKb ? '.md' : '.txt'
      const fileName = name.includes('.') ? name : `${name}${defaultExt}`
      const subPath = currentSubDir ? `${currentSubDir}/${fileName}` : fileName
      const sharePathNorm = shareInfo.path.replace(/\\/g, '/')
      const fullPath = sharePathNorm ? `${sharePathNorm}/${subPath}` : subPath
      createFileMutation.mutate(
        { token, type: 'file', path: subPath, content: '' },
        {
          onSuccess: () => {
            createFileMutation.reset()
            if (inKb) viewFile(fullPath)
          },
        },
      )
    },
    [token, currentSubDir, shareInfo.path, inKb, createFileMutation, viewFile],
  )

  const handleInlineCreateFolder = useCallback(
    (name: string) => {
      const subPath = currentSubDir ? `${currentSubDir}/${name}` : name
      createFolderMutation.mutate(
        { token, type: 'folder', path: subPath },
        {
          onSuccess: () => {
            createFolderMutation.reset()
          },
        },
      )
    },
    [token, currentSubDir, createFolderMutation],
  )

  return (
    <div>
      {/* Move To Dialog */}
      <MoveToDialog
        isOpen={showMoveDialog}
        onClose={() => {
          setShowMoveDialog(false)
          setMoveTarget(null)
          moveMutation.reset()
        }}
        fileName={moveTarget?.name || ''}
        filePath={moveTarget ? stripSharePrefix(moveTarget.path) : ''}
        onMove={handleDialogMove}
        isPending={moveMutation.isPending}
        error={moveMutation.error as Error | null}
        shareToken={token}
        shareRootPath={shareInfo.path}
      />

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
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
            className='space-y-4'
          >
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder='Folder name'
              autoFocus
            />
            <div className='flex justify-end gap-2'>
              <Button variant='outline' type='button' onClick={() => setShowCreateFolder(false)}>
                Cancel
              </Button>
              <Button
                type='submit'
                disabled={!newItemName.trim() || createFolderMutation.isPending}
              >
                {createFolderMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create File Dialog */}
      <Dialog open={showCreateFile} onOpenChange={setShowCreateFile}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create File</DialogTitle>
            <DialogDescription>
              Enter a name for the new file. .{inKb ? 'md' : 'txt'} extension will be added if no
              extension is provided.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const defaultExt = inKb ? '.md' : '.txt'
              const fileName = newItemName.includes('.')
                ? newItemName
                : `${newItemName}${defaultExt}`
              const subPath = currentSubDir ? `${currentSubDir}/${fileName}` : fileName
              const sharePathNorm = shareInfo.path.replace(/\\/g, '/')
              const fullPath = sharePathNorm ? `${sharePathNorm}/${subPath}` : subPath
              createFileMutation.mutate(
                { token, type: 'file', path: subPath, content: '' },
                {
                  onSuccess: () => {
                    setShowCreateFile(false)
                    setNewItemName('')
                    createFileMutation.reset()
                    if (inKb) viewFile(fullPath)
                  },
                },
              )
            }}
            className='space-y-4'
          >
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={inKb ? 'notes.md' : 'notes.txt'}
              autoFocus
            />
            <div className='flex justify-end gap-2'>
              <Button variant='outline' type='button' onClick={() => setShowCreateFile(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={!newItemName.trim() || createFileMutation.isPending}>
                {createFileMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <RenameDialog
        isOpen={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        itemName={renamingItem?.name || ''}
        newName={renameNewName}
        onNewNameChange={setRenameNewName}
        onRename={() => {
          if (renamingItem) {
            const relativeOld = stripSharePrefix(renamingItem.path)
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

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        item={deletingItem}
        onDelete={() => {
          if (deletingItem) {
            deleteItemMutation.mutate(
              { token, path: stripSharePrefix(deletingItem.path) },
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

      <BrowserPane
        mediaPlayers={
          <MediaPlayers
            editableFolders={[]}
            session={session}
            mediaContext={mediaContext}
            shareContext={{ token, shareInfo }}
          />
        }
        progress={
          <UploadProgress
            isUploading={isUploading}
            error={uploadError}
            fileCount={uploadFileCount}
            onDismiss={resetUpload}
          />
        }
        rootClassName={`min-h-screen ${isAudioPlaying ? 'pb-12' : ''}`}
        breadcrumbs={
          <div className='flex items-center gap-1 lg:gap-2 flex-wrap min-w-0 flex-1'>
            {breadcrumbs.map((crumb, index) => {
              const fullPath = crumb.path
                ? `${shareInfo.path.replace(/\\/g, '/')}/${crumb.path}`
                : shareInfo.path.replace(/\\/g, '/')
              const folderItem: FileItem = {
                name: crumb.name,
                path: fullPath,
                type: MediaType.FOLDER,
                size: 0,
                extension: '',
                isDirectory: true,
                isVirtual: false,
              }
              const button = (
                <Button
                  variant={index === breadcrumbs.length - 1 ? 'default' : 'ghost'}
                  size='sm'
                  onClick={() => navigate(crumb.path)}
                  className='gap-1.5 text-sm h-8 px-2.5'
                >
                  {index === 0 && <Folder className='h-4 w-4' />}
                  {crumb.name}
                </Button>
              )
              return (
                <div key={crumb.path} className='flex items-center gap-2'>
                  {index > 0 && <ChevronRight className='h-4 w-4 text-muted-foreground' />}
                  <FileContextMenu
                    file={folderItem}
                    onDownload={handleDownload}
                    onOpenInNewTab={handleOpenInNewTab}
                    onOpenInWorkspace={handleOpenInWorkspace}
                  >
                    {button}
                  </FileContextMenu>
                </div>
              )
            })}
          </div>
        }
        search={{
          visible: inKb,
          placeholder: 'Search notes...',
          value: searchQuery,
          onChange: setSearchQuery,
        }}
        actions={
          canUpload ? (
            <>
              <Button
                variant='outline'
                size='icon'
                onClick={() => {
                  setNewItemName('')
                  setShowCreateFolder(true)
                }}
                title='Create new folder'
                className='h-8 w-8'
              >
                <FolderPlus className='h-4 w-4' />
              </Button>
              <Button
                variant='outline'
                size='icon'
                onClick={() => {
                  setNewItemName('')
                  setShowCreateFile(true)
                }}
                title='Create new file'
                className='h-8 w-8'
              >
                <FilePlus className='h-4 w-4' />
              </Button>
              <UploadMenuButton disabled={isUploading} onUpload={handleUploadFiles} />
              <div className='w-px h-6 bg-border mx-1' />
            </>
          ) : null
        }
        trailingSlot={<ThemeSwitcher variant='header' />}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      >
        <UploadDropZone enabled={canUpload} onUpload={handleUploadFiles}>
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
            loading={isLoading}
            dashboard={
              inKb ? (
                <KbDashboard
                  scopePath={shareInfo.path}
                  onFileClick={handleKbResultClick}
                  shareToken={token}
                  dir={currentSubDir || undefined}
                />
              ) : null
            }
            viewMode={viewMode}
            listView={
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
                onContextOpenInWorkspace={handleOpenInWorkspace}
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
            }
            gridView={
              <FileGridView
                files={files}
                currentPath={currentSubDir}
                playingPath={playingPath}
                onFileClick={handleFileClick}
                onParentDirectory={handleParentDirectory}
                getIcon={getIcon}
                isEditable={canEdit}
                onMoveFile={canEdit ? handleMoveFile : undefined}
                getThumbnailUrl={getThumbnailUrl}
                getImagePreviewUrl={getImagePreviewUrl}
                onContextDownload={handleDownload}
                onContextRename={canEdit ? handleContextRename : undefined}
                onContextDelete={canDelete ? handleContextDelete : undefined}
                onContextMove={canEdit ? handleContextMoveFile : undefined}
                onContextOpenInNewTab={handleOpenInNewTab}
                onContextOpenInWorkspace={handleOpenInWorkspace}
              />
            }
          />
        </UploadDropZone>
      </BrowserPane>
    </div>
  )
}
