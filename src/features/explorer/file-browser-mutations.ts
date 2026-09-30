import { Effect } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { modelOwner, ownedTasks, resourceError, type Snapshot } from 'effectweb'
import { postEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import type {
  FileColumnScope,
  FileColumnVisibility,
  FileSortOrder,
} from '@/lib/models/settings-types'
export type FilePasteVariables = {
  path: string
  content?: string
  base64Content?: string
  mode: 'create' | 'replace'
  expectedVersion?: number
}
export type FileBrowserMutationOptions = { onFileCreated?: (path: string) => void }
export const operationError = (result: AsyncResult.AsyncResult<unknown, Error>) => {
  const message = resourceError(result)
  return message ? new Error(message) : undefined
}
export function createFileOperations(options: FileBrowserMutationOptions = {}) {
  const owner = modelOwner<{ results: Record<string, AsyncResult.AsyncResult<unknown, Error>> }>({
    results: {},
  })
  const filesChanged = () => {
    queryCache.invalidateGroup(groups.files)
    queryCache.invalidateGroup(groups.content)
  }
  const settingsChanged = () => queryCache.invalidateGroup(groups.settings)
  function operation<Args>(
    name: string,
    effect: (args: Args) => Effect.Effect<unknown, Error>,
    settled: () => void,
    success?: (args: Args) => void,
  ) {
    // One owner per operation gives each its own result key; the shared `results` map is derived.
    const status = modelOwner<{ result: AsyncResult.AsyncResult<unknown, Error> }>({
      result: AsyncResult.initial(),
    })
    owner.own(status)
    owner.own(
      status.source.subscribe(({ result }) =>
        owner.edit('results', (results) => ({ ...results, [name]: result })),
      ),
    )
    const tasks = ownedTasks(status, {
      run: {
        policy: 'queue',
        result: 'result',
        run: (args: Args, onSuccess?: () => void) =>
          Effect.suspend(() => effect(args)).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                success?.(args)
                onSuccess?.()
              }),
            ),
            Effect.ensuring(Effect.sync(settled)),
          ),
      },
    })
    const run = (args: Args, onSuccess?: () => void) => tasks.run(args, onSuccess)
    const reset = () => status.patch({ result: AsyncResult.initial() })
    const snapshot = (
      results: Snapshot<Record<string, AsyncResult.AsyncResult<unknown, Error>>>,
    ) => ({ run, reset, result: results[name] ?? AsyncResult.initial() })
    return { run, reset, snapshot }
  }
  const operations = {
    rename: operation(
      'rename',
      (vars: { oldPath: string; newPath: string }) => postEffect('/api/files/rename', vars),
      filesChanged,
    ),
    createFile: operation(
      'create-file',
      (vars: { path: string; content: string }) =>
        postEffect('/api/files/create', { type: 'file', ...vars }),
      filesChanged,
      (vars) => options.onFileCreated?.(vars.path),
    ),
    createFolder: operation(
      'create-folder',
      (vars: { path: string }) => postEffect('/api/files/create', { type: 'folder', ...vars }),
      filesChanged,
    ),
    paste: operation(
      'paste',
      (vars: FilePasteVariables) =>
        postEffect(vars.mode === 'replace' ? '/api/files/edit' : '/api/files/create', {
          ...(vars.mode === 'create' ? { type: 'file' } : {}),
          path: vars.path,
          content: vars.content,
          base64Content: vars.base64Content,
          expectedVersion: vars.expectedVersion,
        }),
      filesChanged,
    ),
    remove: operation(
      'remove',
      (path: string) => postEffect('/api/files/delete', { path }),
      filesChanged,
    ),
    copy: operation(
      'copy',
      (vars: { sourcePath: string; destinationDir: string }) => postEffect('/api/files/copy', vars),
      filesChanged,
    ),
    viewMode: operation(
      'view-mode',
      (vars: { path: string; viewMode: 'list' | 'grid' }) =>
        postEffect('/api/settings/viewMode', vars),
      settingsChanged,
    ),
    knowledgeBase: operation(
      'knowledge-base',
      (filePath: string) => postEffect('/api/settings/knowledgeBase', { filePath }),
      () => {
        settingsChanged()
        filesChanged()
      },
    ),
    setIcon: operation(
      'set-icon',
      (vars: { path: string; iconName: string }) => postEffect('/api/settings/icon', vars),
      settingsChanged,
    ),
    removeIcon: operation(
      'remove-icon',
      (path: string) => postEffect('/api/settings/icon/remove', { path }),
      settingsChanged,
    ),
    favorite: operation(
      'favorite',
      (filePath: string) => postEffect('/api/settings/favorite', { filePath }),
      () => {
        settingsChanged()
        filesChanged()
      },
    ),
    sort: operation(
      'sort',
      (vars: { path: string; sortOrder: FileSortOrder }) =>
        postEffect('/api/settings/sortOrder', { path: vars.path, ...vars.sortOrder }),
      settingsChanged,
    ),
    columns: operation(
      'columns',
      (vars: { scope: FileColumnScope; columns: FileColumnVisibility }) =>
        postEffect('/api/settings/fileColumns', { scope: vars.scope, ...vars.columns }),
      settingsChanged,
    ),
  }
  return {
    ...operations,
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    snapshot: (state: ReturnType<typeof owner.read>) => ({
      renameMutation: operations.rename.snapshot(state.results),
      moveMutation: operations.rename.snapshot(state.results),
      createFileMutation: operations.createFile.snapshot(state.results),
      createFolderMutation: operations.createFolder.snapshot(state.results),
      pasteMutation: operations.paste.snapshot(state.results),
      deleteMutation: operations.remove.snapshot(state.results),
      copyMutation: operations.copy.snapshot(state.results),
      viewModeMutation: operations.viewMode.snapshot(state.results),
      knowledgeBaseMutation: operations.knowledgeBase.snapshot(state.results),
      setCustomIconMutation: operations.setIcon.snapshot(state.results),
      removeCustomIconMutation: operations.removeIcon.snapshot(state.results),
      favorite: operations.favorite.snapshot(state.results),
      sort: operations.sort.snapshot(state.results),
      columns: operations.columns.snapshot(state.results),
    }),
  }
}
export type FileOperations = ReturnType<typeof createFileOperations>
export type FileOperationSnapshot = ReturnType<FileOperations['snapshot']>
