import { virtualDetailSchema, virtualActionSchema } from './hermes-api'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { available, modelOwner, resourceError } from 'effectweb'
import { apiSchemaEffect, postSchemaEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { fileBrowserQuery } from '@/features/explorer/file-browser-listing'
import type { DirectoryListing } from '@/lib/files/virtual-directory'
type Accessor<T> = () => T
import { MediaType, type FileItem } from '@/lib/files/types'
import {
  hasVirtualCapability,
  type VirtualCapability,
  type VirtualDirectory,
  type VirtualEntry,
} from '@/lib/files/virtual-directory'
import { isHermesOpenTarget, type HermesOpenTarget } from './hermes-open-target'
import type { FileBrowserActionOverrides } from '@/features/explorer/file-browser-action-overrides'
import { infiniteResource, observeQuery, query, type InfiniteData } from '@effectweb/query'
type ValueActionDialog = {
  action: 'moveToProject' | 'addProjectFolder' | 'removeProjectFolder' | 'setPrimaryFolder'
  file: FileItem
  entry?: VirtualEntry
  value: string
}
type AppearanceActionDialog = {
  action: 'setAppearance'
  file: FileItem
  entry?: VirtualEntry
  appearance: { icon: string; color: string }
}
type VirtualActionDialog = ValueActionDialog | AppearanceActionDialog
export type HermesProjectDraft = { name: string; primaryPath: string; additionalPaths: string[] }
export type HermesVirtualDirectoryModal = ReturnType<
  ReturnType<typeof createHermesVirtualDirectory>['snapshot']
>['modal']
export type HermesVirtualDirectoryOptions = Readonly<{
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  directory: Accessor<VirtualDirectory | undefined>
  entry: (file: FileItem) => VirtualEntry | undefined
  setError: (message: string) => void
  openTarget?: (file: FileItem, target: HermesOpenTarget) => void
}>
type DetailResponse = typeof virtualDetailSchema.Type
const detailDefinition = query({
  name: 'virtual-directory-detail',
  load: (path: string) =>
    apiSchemaEffect(
      virtualDetailSchema,
      `/api/virtual-directory/open?path=${encodeURIComponent(path)}`,
    ),
})
const actionSlot = 'hermes-directory-action'
const clipboardSlot = 'hermes-copy-id'
export function createHermesVirtualDirectory(options: HermesVirtualDirectoryOptions) {
  const owner = modelOwner({
    projectCreateOpen: false,
    detail: null as { file: FileItem; entry: VirtualEntry } | null,
    deleteAction: null as 'deletePermanently' | 'deleteProject' | null,
    actionDialog: null as VirtualActionDialog | null,
    choices: AsyncResult.initial<InfiniteData<DirectoryListing, number>, Error>(),
    detailResult: AsyncResult.initial<DetailResponse, Error>(),
    operation: AsyncResult.initial<unknown, Error>(),
  })
  const choices = owner.own(infiniteResource(queryCache, fileBrowserQuery))
  owner.own(choices.subscribe((choices) => owner.patch({ choices })))
  const detailObserver = observeQuery(owner, queryCache, detailDefinition, 'detailResult')
  const setProjectCreateOpen = (projectCreateOpen: boolean) => owner.patch({ projectCreateOpen })
  const setDetail = (detail: { file: FileItem; entry: VirtualEntry } | null) => {
    owner.patch({ detail })
    detailObserver.select(detail?.entry.kind === 'session' ? detail.file.path : undefined)
  }
  const deleteAction = () => owner.read().deleteAction
  const setDeleteAction = (deleteAction: 'deletePermanently' | 'deleteProject' | null) =>
    owner.patch({ deleteAction })
  const actionDialog = () => owner.read().actionDialog
  const setActionDialog = (
    next:
      | VirtualActionDialog
      | null
      | ((dialog: VirtualActionDialog | null) => VirtualActionDialog | null),
  ) => {
    owner.edit('actionDialog', (dialog) => (typeof next === 'function' ? next(dialog) : next))
    choices.select(
      owner.read().actionDialog?.action === 'moveToProject'
        ? (options.currentPath().split(/[/\\]/).filter(Boolean)[0] ?? '')
        : undefined,
    )
  }
  const resetAction = () => owner.patch({ operation: AsyncResult.initial() })
  const runAction = (
    body: { action: string; path: string; name?: string; metadata?: Record<string, unknown> },
    success?: (result: { openTarget?: unknown }) => void,
    failure?: (error: Error) => void,
  ) =>
    owner.run(
      actionSlot,
      Effect.sync(() =>
        owner.patch({ operation: AsyncResult.waiting(AsyncResult.initial()) }),
      ).pipe(
        Effect.andThen(
          postSchemaEffect(virtualActionSchema, '/api/virtual-directory/action', body),
        ),
        Effect.tap((result) =>
          Effect.sync(() => {
            owner.patch({ operation: AsyncResult.success(result) })
            success?.(result)
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            owner.patch({ operation: AsyncResult.failure(cause) })
            failure?.(new Error(resourceError(owner.read().operation)))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            queryCache.invalidateGroup(groups.files)
            queryCache.invalidateGroup(groups.content)
          }),
        ),
      ),
      'queue',
    )
  const setActionValue = (value: string) =>
    setActionDialog((dialog) =>
      dialog && dialog.action !== 'setAppearance' ? { ...dialog, value } : dialog,
    )
  const appearanceIcon = () => {
    const dialog = actionDialog()
    return dialog?.action === 'setAppearance' ? dialog.appearance.icon : 'Folder'
  }
  const setAppearanceIcon = (icon: string) =>
    setActionDialog((dialog) =>
      dialog?.action === 'setAppearance'
        ? { ...dialog, appearance: { ...dialog.appearance, icon } }
        : dialog,
    )
  const appearanceColor = () => {
    const dialog = actionDialog()
    return dialog?.action === 'setAppearance' ? dialog.appearance.color : ''
  }
  const setAppearanceColor = (color: string) =>
    setActionDialog((dialog) =>
      dialog?.action === 'setAppearance'
        ? { ...dialog, appearance: { ...dialog.appearance, color } }
        : dialog,
    )
  const projectChoices = () =>
    (available(owner.read().choices)?.pages ?? []).flatMap((page) =>
      page.value.files
        .filter((file) => page.value.virtualEntries?.[file.path]?.kind === 'project')
        .map((file) => ({ name: file.name, path: file.path })),
    )
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
        entry: { provider: 'hermes', kind: 'draft', capabilities: [], openTarget: target },
      })
    }
  }
  function openCreateFile() {
    if (!hasVirtualCapability(options.directory(), 'createFile')) return false
    void runAction(
      { action: 'createFile', path: options.currentPath() },
      (result) => {
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
      reportActionError,
    )
    return true
  }
  function openCreateFolder() {
    if (!hasVirtualCapability(options.directory(), 'createFolder')) return false
    setProjectCreateOpen(true)
    resetAction()
    return true
  }
  function closeCreateProject() {
    if (owner.read().operation.waiting) return
    setProjectCreateOpen(false)
    resetAction()
  }
  function createProject(draft: HermesProjectDraft) {
    if (!hasVirtualCapability(options.directory(), 'createFolder')) return false
    const projectName = draft.name.trim()
    if (!projectName || projectExists(projectName)) return true
    const primaryPath = draft.primaryPath.trim()
    if (!primaryPath) return true
    const folders = [
      primaryPath,
      ...draft.additionalPaths.map((value) => value.trim()).filter(Boolean),
    ]
    void runAction(
      {
        action: 'createFolder',
        path: options.currentPath(),
        name: projectName,
        metadata: { primaryPath, folders },
      },
      () => setProjectCreateOpen(false),
      () => {},
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
    void runAction({ action: 'rename', path: target.path, name }, close, () => {})
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
    void runAction({ action, path: target.path }, close, () => {})
    return true
  }
  const actionOverrides: FileBrowserActionOverrides = {
    openCreateFile,
    rename,
    renameExists,
    remove,
    removeTargetChanged: (target) => {
      if (!target) setDeleteAction(null)
    },
  }
  function handleAction(
    action: VirtualCapability,
    file: FileItem,
    actions: { rename: (file: FileItem) => void; remove: (file: FileItem) => void },
  ) {
    if (action === 'rename') return actions.rename(file)
    const entry = options.entry(file)
    if (action === 'copyId') {
      if (entry?.id)
        owner.run(
          clipboardSlot,
          Effect.tryPromise({
            try: () => navigator.clipboard.writeText(entry.id!),
            catch: (error) => error,
          }).pipe(Effect.catch((error) => Effect.sync(() => reportActionError(error)))),
          'drop',
        )
      return
    }
    if (action === 'moveToProject') {
      setActionDialog({ action, file, entry, value: '' })
      resetAction()
      return
    }
    if (action === 'addProjectFolder') {
      setActionDialog({ action, file, entry, value: '' })
      resetAction()
      return
    }
    if (action === 'removeProjectFolder' || action === 'setPrimaryFolder') {
      setActionDialog({ action, file, entry, value: projectFolders(entry)[0] ?? '' })
      resetAction()
      return
    }
    if (action === 'setAppearance') {
      setActionDialog({
        action,
        file,
        entry,
        appearance: {
          icon: typeof entry?.metadata?.icon === 'string' ? entry.metadata.icon : 'Folder',
          color: typeof entry?.metadata?.color === 'string' ? entry.metadata.color : '',
        },
      })
      resetAction()
      return
    }
    if (action === 'branch') {
      void runAction(
        { action, path: file.path },
        (result) =>
          openActionTarget(
            { ...file, name: `${file.name} branch`, path: `virtual-branch-${Date.now()}` },
            result.openTarget,
          ),
        reportActionError,
      )
      return
    }
    if (action === 'deletePermanently' || action === 'deleteProject') {
      setDeleteAction(action)
      actions.remove(file)
      return
    }
    void runAction({ action, path: file.path }, undefined, reportActionError)
  }
  function submitActionDialog() {
    const dialog = actionDialog()
    if (!dialog) return
    const value =
      dialog.action === 'setAppearance'
        ? ''
        : dialog.value.trim() ||
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
    void runAction(
      body,
      () => setActionDialog(null),
      () => {},
    )
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    snapshot: (
      state: ReturnType<typeof owner.read>,
      input: {
        files: readonly FileItem[]
        directory: VirtualDirectory | undefined
        entry: (file: FileItem) => VirtualEntry | undefined
      },
    ) => {
      const error = resourceError(state.operation)
        ? new Error(resourceError(state.operation))
        : undefined
      const projectChoices = (available(state.choices)?.pages ?? []).flatMap((page) =>
        page.value.files
          .filter((file) => page.value.virtualEntries?.[file.path]?.kind === 'project')
          .map((file) => ({ name: file.name, path: file.path })),
      )
      return {
        entry: input.entry,
        directory: input.directory,
        open,
        download,
        handleAction,
        canCreateFolder: hasVirtualCapability(input.directory, 'createFolder'),
        canCreateFile: hasVirtualCapability(input.directory, 'createFile'),
        openCreateFolder,
        actionOverrides: {
          ...actionOverrides,
          renamePending: state.operation.waiting,
          renameError: error,
          removePending: state.operation.waiting,
          renameExists: (target: FileItem, name: string) => {
            const entry = input.entry(target)
            if (entry?.kind === 'session') return false
            if (entry?.kind !== 'project') return undefined
            return (
              name.toLowerCase() === 'archived' ||
              input.files.some(
                (file) =>
                  file.path !== target.path &&
                  input.entry(file)?.kind === 'project' &&
                  file.name.toLowerCase() === name.toLowerCase(),
              )
            )
          },
          removeTitle:
            state.deleteAction === 'deletePermanently'
              ? 'Delete Session Permanently?'
              : state.deleteAction === 'deleteProject'
                ? 'Delete Project?'
                : undefined,
          removeDescription:
            state.deleteAction === 'deletePermanently'
              ? 'This permanently deletes the archived Hermes session and cannot be undone.'
              : state.deleteAction === 'deleteProject'
                ? 'This removes project metadata only. Directories and sessions are not deleted.'
                : undefined,
          removeConfirmLabel:
            state.deleteAction === 'deletePermanently'
              ? 'Delete Permanently'
              : state.deleteAction === 'deleteProject'
                ? 'Delete Project'
                : undefined,
        },
        modal: {
          detail: state.detail,
          setDetail,
          detailResult: state.detailResult,
          action: {
            dialog: state.actionDialog,
            close: () => setActionDialog(null),
            setValue: setActionValue,
            setAppearance: (appearance: Partial<{ icon: string; color: string }>) => {
              if (appearance.icon !== undefined) setAppearanceIcon(appearance.icon)
              if (appearance.color !== undefined) setAppearanceColor(appearance.color)
            },
            projectChoices: projectChoices,
            projectChoicesLoading: state.choices.waiting,
            projectFolders,
            pending: state.operation.waiting,
            error: error,
            submit: submitActionDialog,
          },
          createProject: {
            open: state.projectCreateOpen,
            close: closeCreateProject,
            submit: createProject,
            pending: state.operation.waiting,
            error: error,
            exists: (name: string) =>
              !!name.trim() &&
              input.files.some(
                (file) =>
                  input.entry(file)?.kind === 'project' &&
                  file.name.toLowerCase() === name.trim().toLowerCase(),
              ),
          },
        },
      }
    },
  }
}
