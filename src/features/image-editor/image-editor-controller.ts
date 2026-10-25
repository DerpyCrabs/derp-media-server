import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { apiEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { showAppConfirmEffect } from '@/lib/ui/app-dialog'
import {
  originalTransform,
  rotateImage,
  flipImage,
  cropImage,
  resizeImage,
  validImageSize,
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
export function imageEditorController(props: ImageEditorProps) {
  let bitmap: ImageBitmap | undefined
  const owner = modelOwner({
    props,
    loading: true,
    error: '',
    pending: false,
    saveDialog: false,
    history: [] as readonly ImageTransform[],
    cursor: 0,
    exportedEdit: undefined as ImageTransform | undefined,
    selection: null as CropRect | null,
    tool: 'none' as 'none' | 'crop' | 'resize',
    resizeWidth: 0,
    resizeHeight: 0,
    keepRatio: true,
  })
  const currentEdit = () => owner.read().history[owner.read().cursor]
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
        const blob = yield* Effect.tryPromise(() => {
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
        if (download) {
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
            owner.patch({ pending: false, saveDialog: false, exportedEdit: edit })
          })
        } else {
          const form = new FormData()
          form.append('targetDir', parentPath(path))
          form.append('file', blob, fileNameFromPath(path))
          yield* apiEffect('/api/files/upload?create_only=true', { method: 'POST', body: form })
          yield* Effect.sync(() => {
            queryCache.invalidateGroup(groups.files)
            owner.patch({ pending: false, saveDialog: false, exportedEdit: edit })
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
    rotate: () => {
      const edit = currentEdit()
      if (edit) commit(rotateImage(edit))
    },
    flip: () => {
      const edit = currentEdit()
      if (edit) commit(flipImage(edit, true))
    },
    undo: () => {
      if (!owner.read().pending)
        owner.patch({ cursor: Math.max(0, owner.read().cursor - 1), selection: null, tool: 'none' })
    },
    redo: () => {
      if (!owner.read().pending)
        owner.patch({
          cursor: Math.min(owner.read().history.length - 1, owner.read().cursor + 1),
          selection: null,
          tool: 'none',
        })
    },
    tool: (tool: 'crop' | 'resize') => {
      const edit = currentEdit()
      if (edit)
        owner.patch({
          tool: owner.read().tool === tool ? 'none' : tool,
          selection: null,
          resizeWidth: edit.width,
          resizeHeight: edit.height,
        })
    },
    selection: (selection: CropRect | null) => owner.patch({ selection }),
    selectAll: () => {
      const edit = currentEdit()
      if (edit) owner.patch({ selection: { x: 0, y: 0, width: edit.width, height: edit.height } })
    },
    cropField: (field: keyof CropRect, value: number) => {
      const selection = owner.read().selection
      if (selection) owner.patch({ selection: { ...selection, [field]: value } })
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
    },
  })
  owner.run(
    'load',
    Effect.tryPromise(async (signal) => {
      const response = await fetch(`/api/files/download?path=${encodeURIComponent(props.path)}`, {
        signal,
      })
      if (!response.ok) throw new Error(`Could not load image (${response.status}).`)
      const source = await createImageBitmap(await response.blob())
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
      bitmap = source
      owner.patch({ loading: false, history: [originalTransform(source.width, source.height)] })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ loading: false, error: message(error) })),
      ),
    ),
    'replace',
  )
  return {
    source: owner.source,
    ...actions,
    receive: (next: ImageEditorProps) => owner.patch({ props: next }),
    lifetime: owner,
  }
}
