import { Effect } from 'effect'
import { apiEffect } from '@/lib/api/client'
import { commandSlot, modelOwner } from 'effectweb'
import { groups, queryCache } from '@/lib/api/cache'
import { collectDroppedUploadFiles } from '@/lib/files/collect-dropped-upload-files'
import { hasFileDragData } from '@/lib/files/file-drag-data'
import type { UploadToastState } from './types'
const uploadSlot = commandSlot('upload')
const toastSlot = commandSlot('upload-toast')
const dropSlot = commandSlot('collect-drop')
export function createUploadDrop(context: () => { currentPath: string; editable: boolean }) {
  const owner = modelOwner({ toast: { kind: 'hidden' } as UploadToastState, dragOver: false })
  let dragDepth = 0
  const hideToast = () => {
    owner.run(toastSlot, Effect.void, 'replace')
    owner.patch({ toast: { kind: 'hidden' } })
  }
  const setError = (message: string) => {
    owner.run(toastSlot, Effect.void, 'replace')
    owner.patch({ toast: { kind: 'error', message } })
  }
  const upload = (files: File[], targetDir = context().currentPath) => {
    if (!files.length || !context().editable) return
    owner.run(
      uploadSlot,
      Effect.sync(() =>
        owner.patch({ toast: { kind: 'uploading', fileCount: files.length } }),
      ).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const desktop = window.derpDesktop
            if (desktop)
              return Effect.tryPromise({
                try: () => desktop.importDrop(files, targetDir),
                catch: (error) => (error instanceof Error ? error : new Error('Upload failed')),
              })
            const formData = new FormData()
            formData.append('targetDir', targetDir)
            for (const file of files) formData.append('files', file, file.name)
            return apiEffect('/api/files/upload', { method: 'POST', body: formData })
          }),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            queryCache.invalidateGroup(groups.files)
            owner.patch({ toast: { kind: 'success' } })
            owner.run(
              toastSlot,
              Effect.sleep(2000).pipe(
                Effect.andThen(Effect.sync(() => owner.patch({ toast: { kind: 'hidden' } }))),
              ),
              'replace',
            )
          }),
        ),
        Effect.catch((error) => Effect.sync(() => setError(error.message))),
      ),
      'queue',
    )
  }
  const isOsFileDrag = (event: DragEvent) =>
    !!event.dataTransfer?.types.includes('Files') && !hasFileDragData(event.dataTransfer)
  const enter = (event: DragEvent) => {
    if (!context().editable || !isOsFileDrag(event)) return
    event.preventDefault()
    dragDepth++
    if (dragDepth === 1) owner.patch({ dragOver: true })
  }
  const leave = (event: DragEvent) => {
    if (!context().editable || !isOsFileDrag(event)) return
    event.preventDefault()
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) owner.patch({ dragOver: false })
  }
  const over = (event: DragEvent) => {
    if (!context().editable || !isOsFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    dragDepth = 0
    owner.patch({ dragOver: false })
    if (!context().editable || !event.dataTransfer?.files.length) return
    const transfer = event.dataTransfer
    owner.run(
      dropSlot,
      (window.derpDesktop
        ? Effect.succeed(Array.from(transfer.files))
        : collectDroppedUploadFiles(transfer)
      ).pipe(
        Effect.tap((files) => Effect.sync(() => upload(files))),
        Effect.catch(() => Effect.void),
      ),
      'queue',
    )
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    upload,
    setError,
    snapshot: (state: ReturnType<typeof owner.read>) => ({
      toast: state.toast,
      hideToast,
      setError,
      uploading: state.toast.kind === 'uploading',
      dragOver: state.dragOver,
      upload,
      enter,
      leave,
      over,
      drop,
    }),
  }
}
