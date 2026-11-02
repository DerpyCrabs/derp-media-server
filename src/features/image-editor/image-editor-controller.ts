import { viewWindow } from '@/lib/browser/view-window'
import type { ControllerHost } from 'effectweb'
import { nativeDownload } from '@/lib/browser/native-download'
import {
  createDocumentDraftWriter,
  findDocumentDrafts,
  removeDocumentDraft,
  type DocumentDraft,
} from '@/lib/editor/document-drafts'
import { registerDesktopCloseHandler } from '@/desktop/close-handlers'
import { randomId } from '@/lib/random-id'
import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { apiEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { dialogsForWindow } from '@/lib/ui/app-dialog'
import {
  originalTransform,
  fitCrop,
  rotateImage,
  flipImage,
  cropImage,
  resizeImage,
  validImageSize,
  parseImageTransform,
  drawEditedImage,
  type ImageTransform,
  type CropRect,
} from './image-transform'

export type ImageEditorProps = {
  path: string
  editableFolders: readonly string[]
  embedded?: boolean
  onClose: () => void
  onSaved: (path: string) => void
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const attempt = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error : new Error(message(error))),
  })
export function imageEditorController(
  props: ImageEditorProps,
  host: ControllerHost = { document: globalThis.document },
) {
  const window = viewWindow(host)
  const document = host.document
  const showAppConfirmEffect = dialogsForWindow(window).confirm

  let bitmap: ImageBitmap | undefined
  let sourceBlob: Blob | undefined
  let sourceVersion = randomId()
  let restoredDraft: DocumentDraft | undefined
  let discarded = false
  let downloadedEdit: ImageTransform | undefined
  const draftWriter = createDocumentDraftWriter(props.path, 'image')
  const owner = modelOwner({
    props,
    loading: true,
    error: '',
    draftError: '',
    draftSaved: false,
    draftCandidates: [] as DocumentDraft[],
    pending: false,
    saveDialog: false,
    history: [] as readonly ImageTransform[],
    cursor: 0,
    exportedEdit: undefined as ImageTransform | undefined,
    selection: null as CropRect | null,
    cropRatio: null as number | null,
    tool: 'none' as 'none' | 'crop' | 'resize',
    resizeWidth: 0,
    resizeHeight: 0,
    keepRatio: true,
  })
  const currentEdit = () => owner.read().history[owner.read().cursor]
  const dirty = () =>
    !discarded && owner.read().cursor > 0 && currentEdit() !== owner.read().exportedEdit
  const persistDraft = async () => {
    const edit = currentEdit()
    if (!sourceBlob || !edit) return draftWriter.flush()
    try {
      await draftWriter.write(
        !discarded && (dirty() || downloadedEdit === edit) ? JSON.stringify(edit) : null,
        sourceVersion,
        sourceBlob,
      )
      if (!owner.disposed && edit === currentEdit())
        owner.patch({ draftSaved: dirty(), draftError: '' })
    } catch (error) {
      if (!owner.disposed)
        owner.patch({
          draftSaved: false,
          draftError: 'Could not back up image edits in this browser. Save a copy before closing.',
        })
      throw error
    }
  }
  const scheduleDraft = () => {
    owner.patch({ draftSaved: false })
    owner.run(
      'image-draft',
      Effect.sleep(200).pipe(
        Effect.andThen(attempt(persistDraft)),
        Effect.catch(() => Effect.void),
      ),
      'replace',
    )
  }
  const clearRecoveredDraft = () => {
    const draft = restoredDraft
    if (draft) {
      restoredDraft = undefined
      void removeDocumentDraft(draft).catch(() => {})
    }
  }

  const commit = (edit: ImageTransform | null | undefined) => {
    if (!edit || owner.read().pending) return
    const state = owner.read()
    owner.patch({
      history: [...state.history.slice(0, state.cursor + 1), edit],
      cursor: state.cursor + 1,
      selection: null,
      tool: 'none',
      error: '',
    })
    scheduleDraft()
  }
  const exportImage = (path: string, format: string, download: boolean) => {
    if (!bitmap || owner.read().pending) return
    const source = bitmap,
      edit = currentEdit()
    if (!edit) return
    owner.patch({ pending: true, error: '' })
    owner.run(
      'export',
      Effect.gen(function* () {
        const blob = yield* attempt(() => {
          const canvas = document.createElement('canvas')
          drawEditedImage(
            canvas,
            source,
            edit,
            undefined,
            format === 'image/jpeg' ? '#fff' : undefined,
          )
          return new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) => {
                canvas.width = canvas.height = 1
                if (blob) resolve(blob)
                else reject(new Error('Could not encode this image. Try a smaller size.'))
              },
              format,
              0.92,
            ),
          )
        })
        if (download && window.derpDesktop?.downloadBlob) {
          const saved = yield* nativeDownload(blob, path)
          owner.patch({ pending: false })
          if (saved) {
            downloadedEdit = undefined
            owner.patch({ saveDialog: false, exportedEdit: edit })
            scheduleDraft()
            clearRecoveredDraft()
          }
        } else if (download) {
          yield* Effect.sync(() => {
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = path
            document.body.append(link)
            link.click()
            link.remove()
            owner.run(
              'download-url',
              Effect.sleep(60_000).pipe(
                Effect.ensuring(Effect.sync(() => URL.revokeObjectURL(url))),
              ),
              'replace',
            )
            downloadedEdit = edit
            owner.patch({ pending: false, saveDialog: false, exportedEdit: edit })
            scheduleDraft()
          })
        } else {
          const form = new FormData()
          form.append('targetDir', parentPath(path))
          form.append('file', blob, fileNameFromPath(path))
          yield* apiEffect('/api/files/upload?create_only=true', { method: 'POST', body: form })
          yield* Effect.sync(() => {
            downloadedEdit = undefined
            queryCache.invalidateGroup(groups.files)
            owner.patch({ pending: false, saveDialog: false, exportedEdit: edit })
            scheduleDraft()
            clearRecoveredDraft()
            owner.read().props.onSaved(path)
          })
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => owner.patch({ error: message(error), pending: false })),
        ),
      ),
      'drop',
    )
  }
  const actions = {
    restoreDraft: () => {
      const draft = owner.read().draftCandidates[0]
      const edit = draft && parseImageTransform(draft.content)
      if (!draft?.attachment || !edit || owner.read().pending) return
      owner.patch({ pending: true, error: '' })
      owner.run(
        'restore-image-draft',
        Effect.gen(function* () {
          if (
            dirty() &&
            !(yield* showAppConfirmEffect({
              title: 'Replace current image edits?',
              message: 'Restore the saved draft in place of the current unsaved edits.',
              confirmLabel: 'Restore draft',
            }))
          ) {
            owner.patch({ pending: false })
            return
          }
          yield* attempt(async (signal) => {
            const restored = await createImageBitmap(draft.attachment!)
            if (signal.aborted || owner.disposed) {
              restored.close()
              return
            }
            if (!validImageSize(restored.width, restored.height)) {
              restored.close()
              throw new Error('The saved image is too large to restore.')
            }
            bitmap?.close()
            bitmap = restored
            sourceBlob = draft.attachment
            sourceVersion = draft.version
            restoredDraft = draft
            owner.patch({
              pending: false,
              history: [originalTransform(restored.width, restored.height), edit],
              cursor: 1,
              exportedEdit: undefined,
              draftCandidates: [],
              selection: null,
              tool: 'none',
            })
            scheduleDraft()
          })
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => owner.patch({ pending: false, error: message(error) })),
          ),
        ),
        'drop',
      )
    },
    discardDraft: () => {
      const draft = owner.read().draftCandidates[0]
      if (!draft || owner.read().pending) return
      owner.run(
        'discard-image-draft',
        attempt(() => removeDocumentDraft(draft)).pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              owner.patch({
                draftCandidates: owner
                  .read()
                  .draftCandidates.filter((item) => item.id !== draft.id),
              }),
            ),
          ),
          Effect.catch(() =>
            Effect.sync(() =>
              owner.patch({ draftError: 'Could not discard this draft. Try again.' }),
            ),
          ),
        ),
        'drop',
      )
    },
    rotate: () => {
      const edit = currentEdit()
      if (edit) commit(rotateImage(edit))
    },
    flip: () => {
      const edit = currentEdit()
      if (edit) commit(flipImage(edit, true))
    },
    undo: () => {
      if (!owner.read().pending) {
        owner.patch({ cursor: Math.max(0, owner.read().cursor - 1), selection: null, tool: 'none' })
        scheduleDraft()
      }
    },
    redo: () => {
      if (!owner.read().pending) {
        owner.patch({
          cursor: Math.min(owner.read().history.length - 1, owner.read().cursor + 1),
          selection: null,
          tool: 'none',
        })
        scheduleDraft()
      }
    },
    tool: (tool: 'crop' | 'resize') => {
      const edit = currentEdit()
      if (edit)
        owner.patch({
          tool: owner.read().tool === tool ? 'none' : tool,
          selection:
            tool === 'crop' && owner.read().tool !== 'crop'
              ? fitCrop(edit, owner.read().cropRatio)
              : null,
          resizeWidth: edit.width,
          resizeHeight: edit.height,
        })
    },
    selection: (selection: CropRect | null) => owner.patch({ selection }),
    cancelTool: () => owner.patch({ tool: 'none', selection: null }),
    cropRatio: (cropRatio: number | null) => {
      const edit = currentEdit()
      if (edit) owner.patch({ cropRatio, selection: fitCrop(edit, cropRatio) })
    },
    crop: () => {
      const edit = currentEdit(),
        selection = owner.read().selection
      if (edit && selection) commit(cropImage(edit, selection))
    },
    resizeField: (dimension: 'width' | 'height', value: number) => {
      const edit = currentEdit()
      if (!edit) return
      const ratio = edit.width / edit.height
      owner.patch(
        dimension === 'width'
          ? {
              resizeWidth: value,
              ...(owner.read().keepRatio
                ? { resizeHeight: Math.max(1, Math.round(value / ratio)) }
                : {}),
            }
          : {
              resizeHeight: value,
              ...(owner.read().keepRatio
                ? { resizeWidth: Math.max(1, Math.round(value * ratio)) }
                : {}),
            },
      )
    },
    keepRatio: (keepRatio: boolean) => owner.patch({ keepRatio }),
    resize: () => {
      const edit = currentEdit(),
        state = owner.read()
      if (edit) commit(resizeImage(edit, state.resizeWidth, state.resizeHeight))
    },
    save: () => owner.patch({ saveDialog: true, error: '' }),
    closeSave: () => {
      if (!owner.read().pending) owner.patch({ saveDialog: false, error: '' })
    },
    export: (path: string, format = 'image/png') => exportImage(path, format, false),
    download: (name: string, format = 'image/png') => exportImage(name, format, true),
    close: () =>
      owner.run(
        'close',
        Effect.gen(function* () {
          if (owner.read().pending) return
          if (
            owner.read().cursor > 0 &&
            currentEdit() !== owner.read().exportedEdit &&
            !(yield* showAppConfirmEffect({
              title: 'Discard image edits?',
              message: 'Your original image has not changed. Unsaved edits will be discarded.',
              confirmLabel: 'Discard edits',
              destructive: true,
            }))
          )
            return
          discarded = !downloadedEdit || downloadedEdit !== currentEdit()
          owner.cancel('image-draft')
          yield* attempt(persistDraft).pipe(Effect.catch(() => Effect.void))
          if (discarded) clearRecoveredDraft()
          owner.read().props.onClose()
        }),
        'drop',
      ),
    draw: (canvas: HTMLCanvasElement) => {
      const edit = currentEdit()
      if (bitmap && edit) drawEditedImage(canvas, bitmap, edit, 1600)
    },
  }
  owner.own({
    dispose: () => {
      bitmap?.close()
      bitmap = undefined
      sourceBlob = undefined
    },
  })
  owner.run(
    'load',
    attempt(async (signal) => {
      const response = await fetch(`/api/files/download?path=${encodeURIComponent(props.path)}`, {
        signal,
      })
      if (!response.ok) throw new Error(`Could not load image (${response.status}).`)
      const blob = await response.blob()
      const source = await createImageBitmap(blob)
      if (signal.aborted || owner.disposed) {
        source.close()
        return
      }
      if (!validImageSize(source.width, source.height)) {
        source.close()
        throw new Error(
          'This image is too large to edit. The limit is 40 megapixels and 16,384 pixels per side.',
        )
      }
      sourceBlob = blob
      bitmap = source
      owner.patch({ loading: false, history: [originalTransform(source.width, source.height)] })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ loading: false, error: message(error) })),
      ),
    ),
    'replace',
  )
  owner.run(
    'find-image-drafts',
    attempt(() => findDocumentDrafts(props.path, 'image')).pipe(
      Effect.tap((drafts) =>
        Effect.sync(() =>
          owner.patch({
            draftCandidates: drafts.filter(
              (draft) => draft.attachment instanceof Blob && parseImageTransform(draft.content),
            ),
          }),
        ),
      ),
      Effect.catch(() =>
        Effect.sync(() =>
          owner.patch({
            draftError: 'Image draft recovery is unavailable. Save a copy before closing.',
          }),
        ),
      ),
    ),
    'drop',
  )
  const flush = () => {
    void persistDraft().catch(() => {})
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  const stopClose = registerDesktopCloseHandler(
    () => Effect.suspend(() => (dirty() ? attempt(persistDraft) : Effect.sync(flush))),
    window,
  )
  owner.own({
    dispose: () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      stopClose?.()
    },
  })
  return {
    beforeDispose: () => {
      owner.cancel('image-draft')
      flush()
    },
    source: owner.source,
    ...actions,
    receive: (next: ImageEditorProps) => owner.patch({ props: next }),
    lifetime: owner,
  }
}
