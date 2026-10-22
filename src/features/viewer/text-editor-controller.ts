import { Effect, Exit, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { available, modelOwner, resourceError } from 'effectweb'
import { apiSchemaEffect, postSchemaEffect, postEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { settingsQuery } from '@/lib/api/queries'
import { createTextDocumentTarget, enqueueTextDocumentSave } from './text-document-target'
import { isPathEditable } from '@/lib/files/path-utils'
import { closeViewer } from '@/lib/browser/url-state-actions'
import { showAppAlertEffect } from '@/lib/ui/app-dialog'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import { observeQuery, query } from '@effectweb/query'
const textDocumentSchema = Schema.Struct({ content: Schema.String, version: Schema.String })
const textVersionSchema = Schema.Struct({ version: Schema.String })
type TextDocumentRemote = typeof textDocumentSchema.Type
export type TextEditorPaneProps = {
  viewingPath: string
  editableFolders: string[]
  knowledgeBases?: string[]
  embedded?: boolean
  showClose?: boolean
  onClose?: () => void
}
const textContentQuery = query({
  name: 'text-content',
  groups: [groups.content],
  load: (path: string) =>
    apiSchemaEffect(textDocumentSchema, `/api/files/text?path=${encodeURIComponent(path)}`),
})
const debounceSlot = 'text-autosave'
const settingsSlot = 'text-settings'
const copySlot = 'text-copy'
const closeSlot = 'text-close'
export const dirtyGuard = (element: HTMLDivElement, current: () => boolean) => {
  const warn = (event: BeforeUnloadEvent) => {
    if (current()) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', warn)
  return () => window.removeEventListener('beforeunload', warn)
}
export function textController(props: TextEditorPaneProps) {
  let closing = false
  let hydrated = false
  let settingsLoaded = false
  const owner = modelOwner({
    props,
    remote: undefined as TextDocumentRemote | undefined,
    loading: true,
    loadError: false,
    settings: undefined as WorkspaceSettings | undefined,
    readOnly: false,
    edit: '',
    base: '',
    version: '',
    copied: false,
    // The latest save: waiting while a save runs or is queued, failed until the next success.
    saved: AsyncResult.initial<void, unknown>(),
  })
  const actions = {
    edit: (edit: string) => {
      owner.patch({ edit })
      schedule()
    },
    reload: () => {
      const remote = owner.read().remote
      if (remote)
        owner.patch({
          edit: remote.content,
          base: remote.content,
          version: remote.version,
          saved: AsyncResult.initial(),
        })
    },
    requestSave: (quiet: boolean) => {
      owner.cancel(debounceSlot)
      void save(quiet)
    },
    save: (quiet: boolean) =>
      Effect.suspend(() => {
        owner.cancel(debounceSlot)
        return save(quiet).await
      }).pipe(Effect.asVoid),
    autoSave: () => {
      const current = owner.read()
      updateSettings(
        !(current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true),
        current.readOnly,
      )
    },
    readOnly: (readOnly: boolean) => {
      owner.patch({ readOnly })
      const current = owner.read()
      updateSettings(
        current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true,
        readOnly,
      )
      schedule()
    },
    copy: () =>
      owner.run(
        copySlot,
        Effect.tryPromise(() => navigator.clipboard.writeText(owner.read().edit)).pipe(
          Effect.tap(() => Effect.sync(() => owner.patch({ copied: true }))),
          Effect.andThen(Effect.sleep(2000)),
          Effect.tap(() => Effect.sync(() => owner.patch({ copied: false }))),
        ),
        'replace',
      ),
    dismiss: () =>
      owner.run(
        closeSlot,
        Effect.gen(function* () {
          const current = owner.read()
          if (
            (current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true) &&
            current.edit !== current.base
          ) {
            if (
              conflict() ||
              !isPathEditable(current.props.viewingPath, [...current.props.editableFolders])
            )
              return
            owner.cancel(debounceSlot)
            // Close only after this save succeeded and nothing was typed while it ran.
            if (Exit.isFailure(yield* save(true).await)) return
            if (owner.read().edit !== owner.read().base) return
          }
          const onClose = owner.read().props.onClose
          if (onClose) onClose()
          else closeViewer()
        }),
        'drop',
      ),
    pasteCanSave: () => {
      const current = owner.read()
      return (
        hydrated &&
        isPathEditable(current.props.viewingPath, [...current.props.editableFolders]) &&
        current.readOnly &&
        (current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true) &&
        !conflict()
      )
    },
  }
  const conflict = () => {
    const current = owner.read()
    return (
      current.edit !== current.base &&
      current.remote !== undefined &&
      current.remote.version !== current.version
    )
  }
  const save = (quiet: boolean) => owner.task('saved', saveDocument(quiet), 'latest-queued')
  const saveDocument = (quiet: boolean) =>
    Effect.gen(function* () {
      const current = owner.read()
      if (quiet && current.edit === current.base) return
      const saved = yield* enqueueTextDocumentSave(
        createTextDocumentTarget(current.props.viewingPath),
        postSchemaEffect(textVersionSchema, '/api/files/edit', {
          path: current.props.viewingPath,
          content: current.edit,
          expectedHash: current.version,
        }).pipe(Effect.map((result) => ({ content: current.edit, version: result.version }))),
      )
      owner.patch({ base: saved.content, version: saved.version })
      queryCache.setQueryData(textContentQuery, current.props.viewingPath, saved)
      queryCache.invalidateQuery(textContentQuery, current.props.viewingPath)
      schedule()
    }).pipe(
      Effect.tapError((error) =>
        quiet
          ? Effect.void
          : showAppAlertEffect(
              error instanceof Error ? error.message : 'Failed to save file',
              'Could not save file',
            ),
      ),
    )
  const schedule = () => {
    owner.cancel(debounceSlot)
    if (closing) return
    const current = owner.read()
    if (
      !hydrated ||
      !isPathEditable(current.props.viewingPath, [...current.props.editableFolders]) ||
      current.readOnly ||
      !(current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true) ||
      conflict() ||
      current.edit === current.base
    )
      return
    owner.run(
      debounceSlot,
      Effect.sleep(2000).pipe(Effect.andThen(Effect.sync(() => void save(true)))),
      'replace',
    )
  }
  const updateSettings = (enabled: boolean, readOnly: boolean) => {
    const current = owner.read()
    if (current.settings)
      queryCache.setQueryData(settingsQuery, true, {
        ...current.settings,
        autoSave: {
          ...current.settings.autoSave,
          [current.props.viewingPath]: { enabled, readOnly },
        },
      })
    owner.run(
      settingsSlot,
      postEffect('/api/settings/autoSave', {
        filePath: current.props.viewingPath,
        enabled,
        readOnly,
      }).pipe(Effect.ensuring(Effect.sync(() => queryCache.invalidateGroup(groups.settings)))),
      'queue',
    )
  }
  const settings = observeQuery(owner, queryCache, settingsQuery, (result) => {
    const data = available(result)
    owner.patch({
      settings: data,
      ...(!settingsLoaded && data
        ? { readOnly: data.autoSave?.[props.viewingPath]?.readOnly ?? false }
        : {}),
    })
    if (data) settingsLoaded = true
    schedule()
  })
  settings.select(true)
  const content = observeQuery(owner, queryCache, textContentQuery, (result) => {
    const remote = available(result)
    const current = owner.read()
    owner.patch({
      remote,
      loading: !remote && result.waiting,
      loadError: !!resourceError(result),
      ...(remote && (!hydrated || current.edit === current.base)
        ? { edit: remote.content, base: remote.content, version: remote.version }
        : {}),
    })
    if (remote) hydrated = true
    schedule()
  })
  content.select(props.viewingPath)
  return {
    source: owner.source,
    ...actions,
    receive: (next: TextEditorPaneProps) => owner.patch({ props: next }),
    beforeDispose: () => {
      closing = true
      owner.cancel(debounceSlot)
    },
    lifetime: {
      close: () =>
        owner.awaitIdle('saved').pipe(
          Effect.andThen(
            Effect.suspend(() => {
              const current = owner.read()
              return hydrated &&
                current.edit !== current.base &&
                !conflict() &&
                isPathEditable(current.props.viewingPath, [...current.props.editableFolders]) &&
                (current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true)
                ? save(true).await
                : Effect.void
            }),
          ),
          Effect.ensuring(owner.close().pipe(Effect.orDie)),
        ),
      dispose: owner.dispose,
    },
  }
}
