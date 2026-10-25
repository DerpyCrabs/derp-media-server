import { Effect } from 'effect'
import { available, controllerView, modelOwner, view } from 'effectweb'
import { observeQuery } from '@effectweb/query'
import { SaveFileDialog } from '@/features/explorer/SaveFileDialog'
import { configQuery } from '@/lib/api/queries'
import { groups, queryCache } from '@/lib/api/cache'
import { apiEffect } from '@/lib/api/client'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { downloadBlob } from '@/lib/files/download-blob'
import { modalFocus } from '@/lib/ui/modal-focus'
import { nativeDownload } from '@/lib/browser/native-download'
import { captureVideoFrame, snapshotName } from './video-snapshot'
import { formatPlaybackTime } from './audio'
export type VideoSnapshotRequest = { path: string; position: number; video: HTMLVideoElement }
type Props = { request: VideoSnapshotRequest; onClose: () => void }
function snapshotController(props: Props) {
  const owner = modelOwner({
    props,
    blob: null as Blob | null,
    preview: '',
    pending: true,
    error: '',
    folders: [] as readonly string[],
    width: props.request.video.videoWidth,
    height: props.request.video.videoHeight,
  })
  let preview = ''
  const config = observeQuery(owner, queryCache, configQuery, (result) =>
    owner.patch({ folders: available(result)?.editableFolders ?? [] }),
  )
  config.select(true)
  owner.own({
    dispose: () => {
      if (preview) URL.revokeObjectURL(preview)
    },
  })
  owner.run(
    'capture',
    Effect.tryPromise({
      try: () => captureVideoFrame(props.request.video),
      catch: (error) =>
        error instanceof Error ? error : new Error('Could not capture this frame.'),
    }).pipe(
      Effect.tap((blob) =>
        Effect.sync(() => {
          preview = URL.createObjectURL(blob)
          owner.patch({ blob, preview, pending: false })
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ pending: false, error: error.message })),
      ),
    ),
    'drop',
  )
  function save(path: string, download: boolean) {
    const { blob, pending } = owner.read()
    if (!blob || pending) return
    owner.patch({ pending: true, error: '' })
    owner.run(
      'export',
      Effect.gen(function* () {
        if (download && window.derpDesktop?.downloadBlob) {
          const saved = yield* nativeDownload(blob, path)
          owner.patch({ pending: false })
          if (saved) props.onClose()
          return
        }
        if (download) {
          downloadBlob(blob, path)
        } else {
          const form = new FormData()
          form.append('targetDir', parentPath(path))
          form.append('file', blob, fileNameFromPath(path))
          yield* apiEffect('/api/files/upload?create_only=true', { method: 'POST', body: form })
          queryCache.invalidateGroup(groups.files)
        }
        owner.patch({ pending: false })
        props.onClose()
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            owner.patch({
              pending: false,
              error: error instanceof Error ? error.message : 'Could not save this frame.',
            }),
          ),
        ),
      ),
      'drop',
    )
  }
  return {
    source: owner.source,
    lifetime: owner,
    close: () => {
      if (!owner.read().pending || !owner.read().blob) props.onClose()
    },
    save: (path: string) => save(path, false),
    download: (name: string) => save(name, true),
  }
}
export const VideoSnapshotDialog = controllerView(
  { controller: snapshotController },
  view((model) =>
    !model.blob ? (
      <div class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'>
        <section
          role='dialog'
          aria-label='Save video frame'
          aria-modal='true'
          use={modalFocus({ onEscape: model.actions.close })}
          class='w-full max-w-lg rounded-lg border border-border bg-background p-4 text-foreground shadow-xl'
        >
          <h2 class='mb-3 font-semibold'>Save video frame</h2>
          <p role={model.error ? 'alert' : 'status'} class='text-sm'>
            {model.error || 'Capturing video frame…'}
          </p>
          <button
            class='mt-4 rounded border border-input px-3 py-1.5 text-sm hover:bg-muted'
            onClick={model.actions.close}
          >
            Cancel
          </button>
        </section>
      </div>
    ) : (
      <SaveFileDialog
        title='Save video frame'
        suggestedPath={snapshotName(model.props.request.path, model.props.request.position)}
        editableFolders={model.blob ? model.folders : []}
        pending={model.pending}
        error={model.error}
        preview={
          model.preview
            ? {
                src: model.preview,
                alt: `Video frame at ${formatPlaybackTime(model.props.request.position)}`,
              }
            : undefined
        }
        description={`${model.width} × ${model.height} · ${formatPlaybackTime(model.props.request.position)} · PNG without subtitles or player controls`}
        onConfirm={model.actions.save}
        onDownload={model.blob ? model.actions.download : undefined}
        onClose={model.actions.close}
      />
    ),
  ),
)
