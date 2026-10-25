import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { apiEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { downloadBlob } from '@/lib/files/download-blob'
import { nativeDownload } from '@/lib/browser/native-download'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import {
  listDocumentDrafts,
  readDocumentDraft,
  removeDocumentDraft,
  subscribeDocumentDraftChanges,
  type DocumentDraft,
  type DocumentDraftSummary,
} from '@/lib/editor/document-drafts'
import {
  draftText,
  exportDocumentDraft,
  recoveredFileName,
  renderImageDraft,
} from '@/lib/editor/draft-export'
export type DraftRecoveryProps = {
  editableFolders: readonly string[]
  onClose: () => void
  onOpenFile: (path: string) => void
}
const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof Error ? error : new Error('Could not access local draft storage.'),
  })
export function draftRecoveryController(props: DraftRecoveryProps) {
  const owner = modelOwner({
    props,
    items: [] as DocumentDraftSummary[],
    filter: '',
    limit: 100,
    loading: true,
    selecting: false,
    pending: false,
    error: '',
    message: '',
    draft: null as DocumentDraft | null,
    preview: '',
    previewUrl: '',
    previewError: '',
    saveDialog: false,
    discard: false,
    changed: false,
  })
  let previewUrl = ''
  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = ''
  }
  owner.own({ dispose: clearPreview })
  function reload() {
    owner.run(
      'list',
      attempt(listDocumentDrafts).pipe(
        Effect.tap((items) =>
          Effect.sync(() => owner.patch({ items, loading: false, changed: false })),
        ),
        Effect.catch((error) =>
          Effect.sync(() => owner.patch({ loading: false, error: error.message })),
        ),
      ),
      'replace',
    )
  }
  owner.own({
    dispose: subscribeDocumentDraftChanges(() => {
      owner.patch({ changed: true })
    }),
  })
  reload()
  function run(effect: Effect.Effect<void, unknown>) {
    if (owner.read().pending) return
    owner.patch({ pending: true, error: '', message: '' })
    owner.run(
      'mutation',
      effect.pipe(
        Effect.tap(() => Effect.sync(() => owner.patch({ pending: false }))),
        Effect.catch((error) =>
          Effect.sync(() =>
            owner.patch({
              pending: false,
              error: error instanceof Error ? error.message : 'Could not recover this draft.',
            }),
          ),
        ),
      ),
      'drop',
    )
  }
  function download(blob: Blob, name: string) {
    return Effect.gen(function* () {
      if (window.derpDesktop?.downloadBlob) {
        const saved = yield* nativeDownload(blob, name)
        if (!saved) return
      } else downloadBlob(blob, name)
      owner.patch({
        saveDialog: false,
        message: 'Download started. The browser backup is kept until you discard it.',
      })
    })
  }
  return {
    source: owner.source,
    reload,
    close: () => {
      if (!owner.read().pending) props.onClose()
    },
    filter: (filter: string) => owner.patch({ filter, limit: 100 }),
    more: () => owner.patch({ limit: owner.read().limit + 100 }),
    select: (id: string) => {
      if (owner.read().pending) return
      clearPreview()
      owner.patch({
        selecting: true,
        draft: null,
        preview: '',
        previewUrl: '',
        previewError: '',
        error: '',
        message: '',
        discard: false,
      })
      owner.run(
        'select',
        Effect.gen(function* () {
          const draft = yield* attempt(() => readDocumentDraft(id))
          if (!draft) {
            owner.patch({ selecting: false, error: 'This backup was removed in another window.' })
            reload()
            return
          }
          owner.patch({ draft, selecting: false })
          if (draft.kind === 'image') {
            const blob = yield* attempt(() => renderImageDraft(draft, 1024))
            previewUrl = URL.createObjectURL(blob)
            owner.patch({ previewUrl })
          } else {
            const text = yield* Effect.try({ try: () => draftText(draft), catch: (error) => error })
            owner.patch({ preview: text.slice(0, 20_000) })
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              owner.patch({
                selecting: false,
                previewError:
                  error instanceof Error ? error.message : 'Could not preview this backup.',
              }),
            ),
          ),
        ),
        'replace',
      )
    },
    openOriginal: () => {
      const draft = owner.read().draft
      if (!draft) return
      run(
        apiEffect(`/api/files/properties?path=${encodeURIComponent(draft.path)}`, {
          notifyForbidden: false,
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              props.onOpenFile(draft.path)
              props.onClose()
            }),
          ),
          Effect.asVoid,
          Effect.catch(() =>
            Effect.fail(
              new Error(
                'The original file is unavailable. You can still download the backup or save a recovered copy.',
              ),
            ),
          ),
        ),
      )
    },
    openSave: () => owner.patch({ saveDialog: true, error: '' }),
    closeSave: () => {
      if (!owner.read().pending) owner.patch({ saveDialog: false })
    },
    saveCopy: (destination: string) => {
      const draft = owner.read().draft
      if (!draft) return
      run(
        Effect.gen(function* () {
          const blob = yield* attempt(() => exportDocumentDraft(draft))
          const form = new FormData()
          form.append('targetDir', parentPath(destination))
          form.append('file', blob, fileNameFromPath(destination))
          yield* apiEffect('/api/files/upload?create_only=true', { method: 'POST', body: form })
          queryCache.invalidateGroup(groups.files)
          owner.patch({
            saveDialog: false,
            message: `Saved ${destination}. The browser backup is kept until you discard it.`,
          })
        }),
      )
    },
    download: (name?: string) => {
      const draft = owner.read().draft
      if (draft)
        run(
          attempt(() => exportDocumentDraft(draft)).pipe(
            Effect.flatMap((blob) => download(blob, name || recoveredFileName(draft))),
          ),
        )
    },
    downloadRaw: () => {
      const draft = owner.read().draft
      if (draft)
        run(
          download(
            new Blob([draft.content], { type: 'application/json' }),
            `${fileNameFromPath(draft.path)}-backup.json`,
          ),
        )
    },
    downloadSource: () => {
      const draft = owner.read().draft
      if (draft?.attachment) run(download(draft.attachment, fileNameFromPath(draft.path)))
    },
    confirmDiscard: (discard: boolean) => owner.patch({ discard }),
    discard: () => {
      const draft = owner.read().draft
      if (!draft) return
      run(
        Effect.gen(function* () {
          yield* attempt(() => removeDocumentDraft(draft))
          const remaining = yield* attempt(() => readDocumentDraft(draft.id))
          if (remaining)
            return yield* Effect.fail(
              new Error(
                'This backup changed in another window and was kept. Select it again before discarding.',
              ),
            )
          clearPreview()
          owner.patch({
            draft: null,
            preview: '',
            previewUrl: '',
            previewError: '',
            discard: false,
          })
          reload()
          return undefined
        }),
      )
    },
    lifetime: owner,
  }
}
