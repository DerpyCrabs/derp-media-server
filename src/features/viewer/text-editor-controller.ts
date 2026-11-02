import { viewWindow } from '@/lib/browser/view-window'
import type { ControllerHost } from 'effectweb'
import { Effect, Exit, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { available, modelOwner, resourceError } from 'effectweb'
import { apiSchemaEffect, postSchemaEffect, postEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { settingsQuery } from '@/lib/api/queries'
import { createTextDocumentTarget, enqueueTextDocumentSave } from './text-document-target'
import { isPathEditable } from '@/lib/files/path-utils'
import { downloadBlobEffect } from '@/lib/files/download-blob'
import { fileNameFromPath } from '@/lib/files/path-utils'
import { closeViewer, viewFile } from '@/lib/browser/url-state-actions'
import {
  createTextDraftWriter,
  findTextDrafts,
  removeTextDraft,
  type TextDraft,
} from '@/lib/editor/text-drafts'
import { registerDesktopCloseHandler } from '@/desktop/close-handlers'
import { dialogsForWindow } from '@/lib/ui/app-dialog'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import { observeQuery, query } from '@effectweb/query'
const textDocumentSchema = Schema.Struct({ content: Schema.String, version: Schema.String })
const textVersionSchema = Schema.Struct({ version: Schema.String })
export type TextDocumentRemote = typeof textDocumentSchema.Type
export type TextEditorPaneProps = {
  viewingPath: string
  editableFolders: string[]
  knowledgeBases?: string[]
  embedded?: boolean
  showClose?: boolean
  onNavigate?: (path: string) => void
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
export const dirtyGuard = (
  element: HTMLDivElement,
  current: () => { dirty: boolean; onSaveAs: () => void; canSaveAs: boolean },
) => {
  const window = viewWindow({ document: element.ownerDocument })
  const warn = (event: BeforeUnloadEvent) => {
    if (current().dirty) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  const keydown = (event: KeyboardEvent) => {
    if (
      current().canSaveAs &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault()
      event.stopPropagation()
      current().onSaveAs()
    }
  }
  element.addEventListener('keydown', keydown, true)
  window.addEventListener('beforeunload', warn)
  return () => {
    element.removeEventListener('keydown', keydown, true)
    window.removeEventListener('beforeunload', warn)
  }
}
export function textController(
  props: TextEditorPaneProps,
  host: ControllerHost = { document: globalThis.document },
) {
  const window = viewWindow(host)
  const showAppAlertEffect = dialogsForWindow(window).alert
  const showAppConfirmEffect = dialogsForWindow(window).confirm

  const draftWriter = createTextDraftWriter(props.viewingPath)
  let restoredFrom: TextDraft | undefined
  let closing = false
  let hydrated = false
  let settingsLoaded = false
  const owner = modelOwner({
    props,
    remote: undefined as TextDocumentRemote | undefined,
    loading: true,
    loadError: '',
    browserDownloads: !window.derpDesktop,
    settings: undefined as WorkspaceSettings | undefined,
    readOnly: false,
    tableView: true,
    edit: '',
    base: '',
    version: '',
    copied: false,
    draftCandidates: [] as readonly TextDraft[],
    draftError: '',
    draftBackedUp: false,
    recovered: false,
    reviewed: false,
    comparison: null as TextDocumentRemote | null,
    comparisonError: '',
    saveAsOpen: false,
    saveAsPending: false,
    saveAsError: '',
    // The latest save: waiting while a save runs or is queued, failed until the next success.
    saved: AsyncResult.initial<void, unknown>(),
  })
  const persistDraft = () => {
    const current = owner.read()
    if (!hydrated) return Promise.resolve()
    return draftWriter
      .write(current.edit === current.base ? null : current.edit, current.version)
      .then(
        () => {
          if (
            !owner.disposed &&
            owner.read().edit === current.edit &&
            owner.read().version === current.version
          )
            owner.patch({ draftError: '', draftBackedUp: current.edit !== current.base })
        },
        () => {
          if (!owner.disposed)
            owner.patch({ draftError: 'Could not back up changes. Save before closing.' })
        },
      )
  }
  const clearRecoveredDraft = () => {
    const draft = restoredFrom
    restoredFrom = undefined
    if (draft)
      owner.run(
        'clear-recovered-draft',
        Effect.tryPromise(() => removeTextDraft(draft)),
        'queue',
      )
  }
  const actions = {
    compare: () => {
      const current = owner.read()
      if (!current.remote) return
      owner.cancel(debounceSlot)
      owner.patch({ comparison: current.remote, comparisonError: '' })
    },
    closeComparison: () => owner.patch({ comparison: null, comparisonError: '' }),
    useReviewed: () => {
      const current = owner.read()
      if (!current.comparison || current.saved.waiting) return
      if (current.remote?.version !== current.comparison.version) {
        owner.patch({
          comparisonError:
            'The file changed again. Review the latest server version before continuing.',
        })
        return
      }
      owner.patch({
        base: current.comparison.content,
        version: current.comparison.version,
        comparison: null,
        comparisonError: '',
        reviewed: current.edit !== current.comparison.content,
        recovered: false,
        saved: AsyncResult.initial(),
      })
      void persistDraft()
    },
    tableView: (tableView: boolean) => owner.patch({ tableView }),
    restoreDraft: (draft: TextDraft) =>
      owner.run(
        'restore-draft',
        Effect.gen(function* () {
          const current = owner.read()
          if (!current.remote) return
          if (
            current.edit !== current.base &&
            !(yield* showAppConfirmEffect({
              title: 'Replace the current draft?',
              message: 'The recovered draft will replace the text currently in this editor.',
              confirmLabel: 'Restore draft',
            }))
          )
            return
          restoredFrom = draft
          owner.cancel(debounceSlot)
          owner.patch({
            edit: draft.content,
            base: current.remote.content,
            version: draft.version,
            recovered: true,
            reviewed: false,
            comparison: null,
            readOnly: false,
            tableView: true,
            draftCandidates: [],
          })
          yield* Effect.tryPromise(persistDraft)
        }),
        'drop',
      ),
    discardDraft: (draft: TextDraft) =>
      owner.run(
        'discard-draft',
        Effect.gen(function* () {
          if (
            !(yield* showAppConfirmEffect({
              title: 'Discard this recovered draft?',
              message: 'This deletes the browser backup. The file on the server will not change.',
              confirmLabel: 'Discard draft',
              destructive: true,
            }))
          )
            return
          yield* Effect.tryPromise(() => removeTextDraft(draft))
          owner.patch({
            draftCandidates: owner.read().draftCandidates.filter((item) => item.id !== draft.id),
          })
        }),
        'drop',
      ),
    openSaveAs: () => owner.patch({ saveAsOpen: true, saveAsError: '' }),
    closeSaveAs: () => {
      if (!owner.read().saveAsPending) owner.patch({ saveAsOpen: false })
    },
    saveAs: (path: string) => {
      if (owner.read().saveAsPending) return
      owner.patch({ saveAsPending: true, saveAsError: '' })
      owner.run(
        'save-as',
        Effect.gen(function* () {
          const snapshot = owner.read()
          yield* postEffect('/api/files/create', { path, content: snapshot.edit })
          yield* owner.awaitIdle('saved')
          owner.cancel(debounceSlot)
          owner.patch({
            base: snapshot.edit,
            saveAsPending: false,
            saveAsOpen: false,
            recovered: false,
          })
          yield* Effect.tryPromise(persistDraft)
          clearRecoveredDraft()
          queryCache.invalidateGroup(groups.files)
          const onNavigate = owner.read().props.onNavigate
          if (onNavigate) onNavigate(path)
          else viewFile(path)
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              owner.patch({
                saveAsPending: false,
                saveAsError: error instanceof Error ? error.message : 'Could not save this copy.',
              }),
            ),
          ),
        ),
        'drop',
      )
    },
    download: () => {
      const current = owner.read()
      owner.run(
        'download-text',
        downloadBlobEffect(
          new Blob([current.edit], { type: 'text/plain;charset=utf-8' }),
          fileNameFromPath(current.props.viewingPath),
        ),
        'replace',
      )
    },
    edit: (edit: string) => {
      owner.patch({ edit, draftBackedUp: false })
      owner.run(
        'draft-backup',
        Effect.sleep(200).pipe(Effect.andThen(Effect.tryPromise(persistDraft))),
        'replace',
      )
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
          recovered: false,
          reviewed: false,
          comparison: null,
        })
      void persistDraft()
      clearRecoveredDraft()
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
      if (
        current.comparison ||
        (quiet && (current.edit === current.base || current.recovered || current.reviewed))
      )
        return
      const saved = yield* enqueueTextDocumentSave(
        createTextDocumentTarget(current.props.viewingPath),
        postSchemaEffect(textVersionSchema, '/api/files/edit', {
          path: current.props.viewingPath,
          content: current.edit,
          expectedHash: current.version,
        }).pipe(Effect.map((result) => ({ content: current.edit, version: result.version }))),
      )
      owner.patch({
        base: saved.content,
        version: saved.version,
        recovered: false,
        reviewed: false,
      })
      yield* Effect.tryPromise(persistDraft)
      clearRecoveredDraft()
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
      current.recovered ||
      current.reviewed ||
      current.comparison ||
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
      loadError: resourceError(result) ?? '',
      ...(remote && !current.comparison && (!hydrated || current.edit === current.base)
        ? { edit: remote.content, base: remote.content, version: remote.version }
        : {}),
    })
    if (remote) hydrated = true
    schedule()
  })
  content.select(props.viewingPath)
  owner.run(
    'find-drafts',
    Effect.tryPromise(() => findTextDrafts(props.viewingPath)).pipe(
      Effect.tap((draftCandidates) => Effect.sync(() => owner.patch({ draftCandidates }))),
      Effect.catch(() =>
        Effect.sync(() =>
          owner.patch({
            draftError: 'Browser draft recovery is unavailable. Save your work before closing.',
          }),
        ),
      ),
    ),
    'replace',
  )
  const flushDraft = () => {
    void persistDraft()
  }
  window.addEventListener('pagehide', flushDraft)
  window.addEventListener('beforeunload', flushDraft)
  const stopClose = registerDesktopCloseHandler(() => Effect.tryPromise(persistDraft), window)
  owner.own({
    dispose: () => {
      window.removeEventListener('pagehide', flushDraft)
      window.removeEventListener('beforeunload', flushDraft)
      stopClose?.()
    },
  })
  return {
    source: owner.source,
    ...actions,
    receive: (next: TextEditorPaneProps) => owner.patch({ props: next }),
    beforeDispose: () => {
      closing = true
      void persistDraft()
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
                !current.recovered &&
                !current.reviewed &&
                !current.comparison &&
                isPathEditable(current.props.viewingPath, [...current.props.editableFolders]) &&
                (current.settings?.autoSave?.[current.props.viewingPath]?.enabled ?? true)
                ? save(true).await
                : Effect.void
            }),
          ),
          Effect.ensuring(
            Effect.tryPromise(persistDraft).pipe(Effect.andThen(owner.close()), Effect.orDie),
          ),
        ),
      dispose: owner.dispose,
    },
  }
}
