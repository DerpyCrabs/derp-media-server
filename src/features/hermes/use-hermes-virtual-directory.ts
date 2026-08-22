import { createInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createSignal, type Accessor } from 'solid-js'
import { api, post } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { MediaType, type FileItem } from '@/lib/files/types'
import {
  hasVirtualCapability,
  type VirtualCapability,
  type VirtualDirectory,
  type VirtualEntry,
} from '@/lib/files/virtual-directory'
import { isHermesOpenTarget, type HermesOpenTarget } from './hermes-open-target'
import {
  fetchFileBrowserListing,
  FILE_BROWSER_INITIAL_PAGE,
  fileBrowserListingQueryKey,
  nextFileBrowserListingPage,
} from '@/features/explorer/file-browser-listing-query'
import type { FileBrowserActionOverrides } from '@/features/explorer/virtual-directory-feature'

type VirtualActionDialog = {
  action:
    | 'moveToProject'
    | 'addProjectFolder'
    | 'removeProjectFolder'
    | 'setPrimaryFolder'
    | 'setAppearance'
  file: FileItem
  entry?: VirtualEntry
}

export type HermesVirtualDirectoryModal = ReturnType<typeof useHermesVirtualDirectory>['modal']

export type HermesVirtualDirectoryOptions = Readonly<{
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  directory: Accessor<VirtualDirectory | undefined>
  entry: (file: FileItem) => VirtualEntry | undefined
  setError: (message: string) => void
  openTarget?: (file: FileItem, target: HermesOpenTarget) => void
}>

export function useHermesVirtualDirectory(options: HermesVirtualDirectoryOptions) {
  const queryClient = useQueryClient()
  const [projectPrimaryPath, setProjectPrimaryPath] = createSignal('')
  const [projectAdditionalPaths, setProjectAdditionalPaths] = createSignal('')
  const [gatewayPickerPath, setGatewayPickerPath] = createSignal('')
  const [projectCreateOpen, setProjectCreateOpen] = createSignal(false)
  const [detail, setDetail] = createSignal<{ file: FileItem; entry: VirtualEntry } | null>(null)
  const [deleteAction, setDeleteAction] = createSignal<
    'deletePermanently' | 'deleteProject' | null
  >(null)
  const [actionDialog, setActionDialog] = createSignal<VirtualActionDialog | null>(null)
  const [actionValue, setActionValue] = createSignal('')
  const [appearanceIcon, setAppearanceIcon] = createSignal('Folder')
  const [appearanceColor, setAppearanceColor] = createSignal('')

  const projectRoot = createMemo(
    () => options.currentPath().split(/[/\\]/).filter(Boolean)[0] ?? '',
  )
  const projectChoicesQuery = createInfiniteQuery(() => ({
    queryKey: fileBrowserListingQueryKey(projectRoot()),
    initialPageParam: FILE_BROWSER_INITIAL_PAGE,
    queryFn: ({ pageParam }) => fetchFileBrowserListing(projectRoot(), pageParam),
    getNextPageParam: nextFileBrowserListingPage,
    enabled: actionDialog()?.action === 'moveToProject',
  }))
  const projectChoices = createMemo(() =>
    (projectChoicesQuery.data?.pages ?? [])
      .flatMap((page) =>
        page.files.map((file) => ({ file, entry: page.virtualEntries?.[file.path] })),
      )
      .filter(({ entry }) => entry?.kind === 'project')
      .map(({ file }) => ({ name: file.name, path: file.path })),
  )

  const gatewayDirectoryQuery = useQuery(() => ({
    queryKey: ['virtual-directory', 'gateway-fs', gatewayPickerPath()],
    queryFn: () =>
      api<{ entries: { name: string; path: string; isDirectory: boolean }[]; error?: string }>(
        `/api/virtual-directory/fs?path=${encodeURIComponent(gatewayPickerPath())}`,
      ),
    enabled: projectCreateOpen() && hasVirtualCapability(options.directory(), 'createFolder'),
  }))

  const detailQuery = useQuery(() => ({
    queryKey: ['virtual-directory', 'open', detail()?.file.path],
    queryFn: () =>
      api<{ session: Record<string, unknown>; messages: unknown }>(
        `/api/virtual-directory/open?path=${encodeURIComponent(detail()!.file.path)}`,
      ),
    enabled: detail()?.entry.kind === 'session',
  }))

  const mutation = useMutation(() => ({
    mutationFn: (body: {
      action: string
      path: string
      name?: string
      metadata?: Record<string, unknown>
    }) => post<{ openTarget?: unknown }>('/api/virtual-directory/action', body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })
    },
  }))

  function reportActionError(error: unknown) {
    options.setError(error instanceof Error ? error.message : 'Hermes action failed')
  }

  function openActionTarget(file: FileItem, target: unknown) {
    if (!isHermesOpenTarget(target)) {
      options.setError('Hermes returned an invalid open target')
      return
    }
    openCreatedTarget(file, target)
  }

  function projectFolders(entry?: VirtualEntry): string[] {
    const metadata = entry?.metadata ?? {}
    const folders = Array.isArray(metadata.folders) ? metadata.folders : []
    const paths = folders.flatMap((folder) => {
      if (typeof folder === 'string') return [folder]
      if (folder && typeof folder === 'object' && typeof folder.path === 'string') {
        return [folder.path]
      }
      return []
    })
    const primary =
      typeof metadata.primary_path === 'string'
        ? metadata.primary_path
        : typeof metadata.primaryPath === 'string'
          ? metadata.primaryPath
          : ''
    return [...new Set([primary, ...paths].filter(Boolean))]
  }

  function open(file: FileItem): boolean {
    const virtualEntry = options.entry(file)
    if (!virtualEntry?.openTarget || !isHermesOpenTarget(virtualEntry.openTarget)) return false
    if (options.openTarget) options.openTarget(file, virtualEntry.openTarget)
    else setDetail({ file, entry: virtualEntry })
    return true
  }

  function download(file: FileItem): boolean {
    const virtualEntry = options.entry(file)
    if (!virtualEntry || !hasVirtualCapability(virtualEntry, 'download')) return false
    const link = document.createElement('a')
    link.href = `/api/virtual-directory/export?path=${encodeURIComponent(file.path)}`
    link.download = `${file.name}.json`
    link.click()
    return true
  }

  function openCreatedTarget(file: FileItem, target: HermesOpenTarget) {
    if (options.openTarget) options.openTarget(file, target)
    else {
      setDetail({
        file,
        entry: {
          provider: 'hermes',
          kind: 'draft',
          capabilities: [],
          openTarget: target,
        },
      })
    }
  }

  function openCreateFile() {
    if (!hasVirtualCapability(options.directory(), 'createFile')) return false
    mutation.mutate(
      { action: 'createFile', path: options.currentPath() },
      {
        onSuccess: (result) => {
          openActionTarget(
            {
              name: 'Untitled session',
              path: `virtual-draft-${Date.now()}`,
              type: MediaType.OTHER,
              size: 0,
              extension: '',
              isDirectory: false,
              isVirtual: true,
            },
            result.openTarget,
          )
        },
        onError: reportActionError,
      },
    )
    return true
  }

  function openCreateFolder() {
    if (!hasVirtualCapability(options.directory(), 'createFolder')) return false
    setProjectPrimaryPath('')
    setProjectAdditionalPaths('')
    setGatewayPickerPath('')
    mutation.reset()
    setProjectCreateOpen(true)
    return true
  }

  function closeCreateProject() {
    if (mutation.isPending) return
    setProjectCreateOpen(false)
    mutation.reset()
  }

  function createProject(name: string) {
    if (!hasVirtualCapability(options.directory(), 'createFolder')) return false
    const projectName = name.trim()
    if (!projectName || projectExists(projectName)) return true
    const primaryPath = projectPrimaryPath().trim()
    if (!primaryPath) return true
    const folders = [
      primaryPath,
      ...projectAdditionalPaths()
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ]
    mutation.mutate(
      {
        action: 'createFolder',
        path: options.currentPath(),
        name: projectName,
        metadata: { primaryPath, folders },
      },
      { onSuccess: () => setProjectCreateOpen(false) },
    )
    return true
  }

  function projectExists(name: string) {
    const normalized = name.trim().toLowerCase()
    return (
      !!normalized &&
      options
        .files()
        .some(
          (file) =>
            options.entry(file)?.kind === 'project' && file.name.toLowerCase() === normalized,
        )
    )
  }

  function rename(target: FileItem, name: string, close: () => void) {
    const virtualEntry = options.entry(target)
    if (!virtualEntry || !hasVirtualCapability(virtualEntry, 'rename')) return false
    mutation.mutate({ action: 'rename', path: target.path, name }, { onSuccess: close })
    return true
  }

  function renameExists(target: FileItem, name: string) {
    const virtualEntry = options.entry(target)
    if (virtualEntry?.kind === 'session') return false
    if (virtualEntry?.kind !== 'project') return undefined
    if (name.toLowerCase() === 'archived') return true
    return options
      .files()
      .some(
        (file) =>
          file.path !== target.path &&
          options.entry(file)?.kind === 'project' &&
          file.name.toLowerCase() === name.toLowerCase(),
      )
  }

  function remove(target: FileItem, close: () => void) {
    const action = deleteAction()
    if (!action) return false
    mutation.mutate({ action, path: target.path }, { onSuccess: close })
    return true
  }

  const actionOverrides: FileBrowserActionOverrides = {
    openCreateFile,
    rename,
    renameExists,
    renamePending: () => mutation.isPending,
    renameError: () => mutation.error,
    remove,
    removePending: () => mutation.isPending,
    removeTargetChanged: (target) => {
      if (!target) setDeleteAction(null)
    },
    removeTitle: () =>
      deleteAction() === 'deletePermanently'
        ? 'Delete Session Permanently?'
        : deleteAction() === 'deleteProject'
          ? 'Delete Project?'
          : undefined,
    removeDescription: () =>
      deleteAction() === 'deletePermanently'
        ? 'This permanently deletes the archived Hermes session and cannot be undone.'
        : deleteAction() === 'deleteProject'
          ? 'This removes project metadata only. Directories and sessions are not deleted.'
          : undefined,
    removeConfirmLabel: () =>
      deleteAction() === 'deletePermanently'
        ? 'Delete Permanently'
        : deleteAction() === 'deleteProject'
          ? 'Delete Project'
          : undefined,
  }

  function handleAction(
    action: VirtualCapability,
    file: FileItem,
    actions: { rename: (file: FileItem) => void; remove: (file: FileItem) => void },
  ) {
    if (action === 'rename') return actions.rename(file)
    const entry = options.entry(file)
    if (action === 'copyId') {
      if (entry?.id) void navigator.clipboard.writeText(entry.id).catch(reportActionError)
      return
    }
    if (action === 'moveToProject') {
      setActionDialog({ action, file, entry })
      setActionValue('')
      mutation.reset()
      return
    }
    if (action === 'addProjectFolder') {
      setActionDialog({ action, file, entry })
      setActionValue('')
      mutation.reset()
      return
    }
    if (action === 'removeProjectFolder' || action === 'setPrimaryFolder') {
      setActionDialog({ action, file, entry })
      setActionValue(projectFolders(entry)[0] ?? '')
      mutation.reset()
      return
    }
    if (action === 'setAppearance') {
      setActionDialog({ action, file, entry })
      setAppearanceIcon(typeof entry?.metadata?.icon === 'string' ? entry.metadata.icon : 'Folder')
      setAppearanceColor(typeof entry?.metadata?.color === 'string' ? entry.metadata.color : '')
      mutation.reset()
      return
    }
    if (action === 'branch') {
      mutation.mutate(
        { action, path: file.path },
        {
          onSuccess: (result) =>
            openActionTarget(
              { ...file, name: `${file.name} branch`, path: `virtual-branch-${Date.now()}` },
              result.openTarget,
            ),
          onError: reportActionError,
        },
      )
      return
    }
    if (action === 'deletePermanently' || action === 'deleteProject') {
      setDeleteAction(action)
      actions.remove(file)
      return
    }
    mutation.mutate({ action, path: file.path }, { onError: reportActionError })
  }

  function submitActionDialog() {
    const dialog = actionDialog()
    if (!dialog) return
    const value =
      actionValue().trim() ||
      (dialog.action === 'moveToProject' ? (projectChoices()[0]?.name ?? '') : '')
    if (dialog.action !== 'setAppearance' && !value) return
    const body =
      dialog.action === 'setAppearance'
        ? {
            action: dialog.action,
            path: dialog.file.path,
            metadata: { icon: appearanceIcon(), color: appearanceColor() },
          }
        : { action: dialog.action, path: dialog.file.path, name: value }
    mutation.mutate(body, { onSuccess: () => setActionDialog(null) })
  }

  return {
    entry: options.entry,
    directory: options.directory,
    open,
    download,
    handleAction,
    canCreateFolder: () => hasVirtualCapability(options.directory(), 'createFolder'),
    canCreateFile: () => hasVirtualCapability(options.directory(), 'createFile'),
    openCreateFolder,
    actionOverrides,
    modal: {
      detail,
      setDetail,
      detailQuery,
      actionDialog,
      setActionDialog,
      actionValue,
      setActionValue,
      appearanceIcon,
      setAppearanceIcon,
      appearanceColor,
      setAppearanceColor,
      projectChoices,
      projectChoicesLoading: () => projectChoicesQuery.isPending,
      projectFolders,
      mutation,
      submitActionDialog,
      createProject: {
        open: projectCreateOpen,
        close: closeCreateProject,
        submit: createProject,
        primaryPath: projectPrimaryPath,
        setPrimaryPath: setProjectPrimaryPath,
        additionalPaths: projectAdditionalPaths,
        setAdditionalPaths: setProjectAdditionalPaths,
        gatewayPath: gatewayPickerPath,
        setGatewayPath: setGatewayPickerPath,
        gatewayEntries: () => gatewayDirectoryQuery.data?.entries ?? [],
        gatewayError: () => gatewayDirectoryQuery.data?.error,
        pending: () => mutation.isPending,
        error: () => mutation.error,
        exists: projectExists,
      },
    },
  }
}
