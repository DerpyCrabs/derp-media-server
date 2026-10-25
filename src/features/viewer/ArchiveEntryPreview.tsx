import { createMediaFocus } from '@/features/playback/media-focus'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
import { Effect } from 'effect'
import { controllerView, domBinding, modelOwner, view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import { LazyPlainTextDocument } from '@/lib/editor/LazyPlainTextDocument'
import { modalFocus } from '@/lib/ui/modal-focus'
import { downloadBlob } from '@/lib/files/download-blob'
import { nativeDownload } from '@/lib/browser/native-download'
import {
  archivePreviewKind,
  previewText,
  readArchiveEntry,
  type ArchivePreviewKind,
} from './archive-preview'
const PdfPreview = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./ArchivePdfPreview')),
      (module) => module.default,
    ),
  {
    pending: view(() => <p class='p-4 text-sm'>Loading PDF preview…</p>),
    failure: view(() => (
      <p role='alert' class='p-4 text-sm text-destructive'>
        The PDF viewer could not load. Download this file to open it separately.
      </p>
    )),
  },
)
const previewMedia = (element: HTMLMediaElement) => {
  const session = getPlaybackSession()
  const play = () => session.dispatch({ type: 'pause' })
  element.addEventListener('play', play)
  const stop = session.subscribe(() => {
    if (session.getSnapshot().desiredPlaying) element.pause()
  })
  const focus = createMediaFocus({
    isPlaying: () => !element.paused,
    pause: () => element.pause(),
    subscribe: (listener) => {
      for (const event of ['play', 'pause', 'ended']) element.addEventListener(event, listener)
      return () => {
        for (const event of ['play', 'pause', 'ended']) element.removeEventListener(event, listener)
      }
    },
  })
  return () => {
    stop()
    focus.dispose()
    element.removeEventListener('play', play)
    element.pause()
    element.removeAttribute('src')
    element.load()
  }
}
type Props = {
  archive: string
  entry: string
  onClose: () => void
  onNavigate: (offset: number) => void
  previous: boolean
  next: boolean
}
function controller(props: Props) {
  const owner = modelOwner({
    props,
    blob: null as Blob | null,
    url: '',
    text: '',
    kind: archivePreviewKind(props.entry),
    loading: true,
    error: '',
    pending: false,
    actualSize: false,
  })
  let url = ''
  owner.own({
    dispose: () => {
      if (url) URL.revokeObjectURL(url)
    },
  })
  owner.run(
    'load',
    Effect.gen(function* () {
      const blob = yield* readArchiveEntry(props.archive, props.entry)
      let kind: ArchivePreviewKind = archivePreviewKind(props.entry)
      let text = ''
      if (kind === 'text') {
        const result = yield* Effect.tryPromise(() => previewText(blob))
        if (result === undefined) kind = 'binary'
        else text = result
      }
      url = URL.createObjectURL(blob)
      owner.patch({ blob, url, text, kind, loading: false })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ loading: false, error: error.message })),
      ),
    ),
    'drop',
  )
  return {
    source: owner.source,
    close: () => {
      if (!owner.read().pending) props.onClose()
    },
    navigate: (offset: number) => {
      if (!owner.read().pending) props.onNavigate(offset)
    },
    size: () => owner.patch({ actualSize: !owner.read().actualSize }),
    mediaError: () =>
      owner.patch({
        error:
          'This file cannot be displayed by the browser. Download it or extract it to open in another application.',
      }),
    download: () => {
      const { blob, pending } = owner.read()
      if (!blob || pending) return
      const name = props.entry.split('/').pop() || 'file'
      if (!window.derpDesktop?.downloadBlob) {
        downloadBlob(blob, name)
        return
      }
      owner.patch({ pending: true })
      owner.run(
        'download',
        nativeDownload(blob, name).pipe(
          Effect.tap(() => Effect.sync(() => owner.patch({ pending: false }))),
          Effect.catch((error) =>
            Effect.sync(() => owner.patch({ pending: false, error: error.message })),
          ),
        ),
        'drop',
      )
    },
    lifetime: owner,
  }
}
const button =
  'min-h-8 rounded-md border border-input px-2.5 py-1 text-sm hover:bg-accent disabled:opacity-40'
export const ArchiveEntryPreview = controllerView(
  { controller, identity: (props) => `${props.archive}\0${props.entry}` },
  view((model) => {
    const { actions, props } = model
    return (
      <section
        role='dialog'
        aria-modal='true'
        aria-label='Archive file preview'
        class='absolute inset-0 z-30 flex min-h-0 flex-col bg-background'
        use={modalFocus({ onEscape: actions.close })}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            (event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')
          )
            return
          if (model.kind === 'image' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault()
            event.stopPropagation()
            actions.navigate(event.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
      >
        <header class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2'>
          <button class={button} disabled={model.pending} onClick={actions.close} autofocus>
            Back to archive
          </button>
          <span class='min-w-20 flex-1 truncate text-sm font-medium' title={props.entry}>
            {props.entry}
          </span>
          {model.kind === 'image' ? (
            <button class={button} onClick={actions.size}>
              {model.actualSize ? 'Fit image' : 'Actual size'}
            </button>
          ) : null}
          <button
            class={button}
            aria-label='Previous archive file'
            disabled={!props.previous || model.pending}
            onClick={() => actions.navigate(-1)}
          >
            ←
          </button>
          <button
            class={button}
            aria-label='Next archive file'
            disabled={!props.next || model.pending}
            onClick={() => actions.navigate(1)}
          >
            →
          </button>
          <button class={button} disabled={!model.blob || model.pending} onClick={actions.download}>
            {model.pending ? 'Downloading…' : 'Download file'}
          </button>
        </header>
        {model.loading ? (
          <p role='status' class='p-4 text-sm'>
            Reading archive file…
          </p>
        ) : null}
        {model.error ? (
          <p role='alert' class='p-4 text-sm text-destructive'>
            {model.error}
          </p>
        ) : null}
        <div class='min-h-0 flex-1'>
          {model.blob && model.kind === 'text' ? (
            <LazyPlainTextDocument
              path={props.entry}
              content={model.text}
              readOnly
              code
              ariaLabel='Archive text preview'
              onChange={() => {}}
              onBlur={() => {}}
              onSave={() => Effect.void}
            />
          ) : null}
          {model.blob && model.kind === 'image' ? (
            <div class='grid h-full overflow-auto p-3'>
              <img
                alt={props.entry}
                src={model.url}
                class={
                  model.actualSize
                    ? 'm-auto max-w-none'
                    : 'm-auto max-h-full max-w-full object-contain'
                }
                style={model.actualSize ? undefined : { height: '100%', width: '100%' }}
                onError={actions.mediaError}
              />
            </div>
          ) : null}
          {model.blob && model.kind === 'pdf' ? (
            <PdfPreview blob={model.blob} name={props.entry} />
          ) : null}
          {model.blob && (model.kind === 'audio' || model.kind === 'video') ? (
            <div class='flex h-full items-center justify-center p-4'>
              {model.kind === 'audio' ? (
                <audio
                  use={domBinding(null, previewMedia)}
                  aria-label='Archive audio preview'
                  class='w-full max-w-xl'
                  src={model.url}
                  controls
                  preload='metadata'
                  onError={actions.mediaError}
                />
              ) : (
                <video
                  use={domBinding(null, previewMedia)}
                  aria-label='Archive video preview'
                  class='max-h-full max-w-full'
                  src={model.url}
                  controls
                  preload='metadata'
                  onError={actions.mediaError}
                />
              )}
            </div>
          ) : null}
          {model.blob && model.kind === 'binary' ? (
            <p class='p-4 text-sm text-muted-foreground'>
              No inline preview for this file. Text previews support UTF-8 files up to 2 MiB.
              Download the file or extract it to open separately.
            </p>
          ) : null}
        </div>
        <p class='shrink-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground'>
          Read-only preview · the archive is unchanged
        </p>
      </section>
    )
  }),
)
