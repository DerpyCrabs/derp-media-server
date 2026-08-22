import Headphones from 'lucide-solid/icons/headphones'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import { Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { MediaType } from '@/lib/files/types'
import { playbackItemFromPath, playbackPathKey, playbackPathMatches } from '@/features/playback'
import {
  usePlaybackMediaHost,
  usePlaybackSession,
  usePlaybackSnapshot,
} from '@/features/playback/PlaybackProvider'

type Props = {
  viewingPath: Accessor<string>
  contentVisible: Accessor<boolean>
  autoplay: boolean
  showListenOnly: boolean
  onMetadataLoaded?: (width: number, height: number) => void
  onListenOnly?: () => void
}

export function VideoViewerPane(props: Props) {
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const mediaHost = usePlaybackMediaHost()
  const [element, setElement] = createSignal<HTMLVideoElement>()
  const [readyKey, setReadyKey] = createSignal('')
  const active = createMemo(() => {
    const state = playback()
    return (
      state.mode === 'video' &&
      state.currentItem?.media === 'video' &&
      playbackPathMatches(state.currentItem, props.viewingPath())
    )
  })
  const loading = createMemo(() => {
    if (!active()) return false
    const state = playback()
    if (state.phase === 'resolving') return true
    const sourceKey = state.source
      ? `${state.currentItem?.locator ?? ''}\0${state.source.generation}`
      : ''
    return !!sourceKey && readyKey() !== sourceKey
  })
  const error = createMemo(() => (active() ? playback().error : null))
  const fileName = createMemo(() => props.viewingPath().split(/[/\\]/).pop() ?? 'file')
  const downloadHref = createMemo(() => fileDownloadHref(props.viewingPath()))

  let offeredPath = ''
  createEffect(
    () => {
      const path = props.viewingPath()
      return {
        path,
        currentItem: playback().currentItem,
        visible: props.contentVisible(),
        key: path ? playbackPathKey(path) : '',
      }
    },
    ({ path, currentItem, visible, key }) => {
      if (!path || !visible || offeredPath === key) return
      offeredPath = key
      if (playbackPathMatches(currentItem, path) || (currentItem && !props.autoplay)) return
      playbackSession.dispatch({
        type: 'load',
        item: playbackItemFromPath(path, 'video'),
        autoplay: props.autoplay,
        mode: 'video',
      })
    },
  )

  createEffect(
    () => {
      const video = element()
      const path = props.viewingPath()
      return video && path && props.contentVisible() && active() ? { video, path } : null
    },
    (attachment) => {
      if (!attachment) return undefined
      const detach = mediaHost.attach(attachment.video, 'video')
      return () => {
        const state = playbackSession.getSnapshot()
        if (
          state.mode === 'video' &&
          state.desiredPlaying &&
          playbackPathMatches(state.currentItem, attachment.path)
        ) {
          playbackSession.dispatch({ type: 'pause' })
        }
        detach()
      }
    },
  )

  function listenOnly() {
    const path = props.viewingPath()
    if (!path) return
    const videoTime = element()?.currentTime
    const position =
      videoTime !== undefined && Number.isFinite(videoTime)
        ? videoTime
        : active()
          ? playback().position
          : 0
    if (active()) {
      playbackSession.dispatch({ type: 'seek', position })
      playbackSession.dispatch({ type: 'setMode', mode: 'audio' })
      playbackSession.dispatch({ type: 'play' })
    } else {
      playbackSession.dispatch({
        type: 'load',
        item: playbackItemFromPath(path, 'video'),
        autoplay: true,
        position,
        mode: 'audio',
      })
    }
    props.onListenOnly?.()
  }

  return (
    <div class='flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-black'>
      <div class='group relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
        <Show when={props.showListenOnly}>
          <div class='absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100'>
            <button
              type='button'
              title='Listen only'
              aria-label='Listen only'
              class='bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md'
              onClick={listenOnly}
            >
              <Headphones class='h-4 w-4' stroke-width={2} />
            </button>
          </div>
        </Show>
        <Show when={loading() && !error()}>
          <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 text-white'>
            <LoaderCircle class='h-7 w-7 animate-spin' stroke-width={2} />
          </div>
        </Show>
        <Show when={error()}>
          {(message) => (
            <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white'>
              <p class='text-sm'>{message()}</p>
              <div class='flex gap-2'>
                <button
                  type='button'
                  class='rounded-md bg-white px-3 py-1.5 text-sm text-black'
                  onClick={() => playbackSession.dispatch({ type: 'retry' })}
                >
                  Retry
                </button>
                <a
                  href={downloadHref()}
                  download={fileName()}
                  class='rounded-md border border-white/40 px-3 py-1.5 text-sm'
                >
                  Download
                </a>
              </div>
            </div>
          )}
        </Show>
        <video
          ref={(video) => setElement(video ?? undefined)}
          class='min-h-0 w-full flex-1 bg-black object-contain'
          controls
          playsinline
          data-media-type={MediaType.VIDEO}
          data-playback-media-host={active() && props.contentVisible() ? 'video' : undefined}
          title={fileName()}
          onCanPlay={() => {
            const state = playback()
            setReadyKey(
              state.source ? `${state.currentItem?.locator ?? ''}\0${state.source.generation}` : '',
            )
          }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            if (video.videoWidth > 0 && video.videoHeight > 0)
              props.onMetadataLoaded?.(video.videoWidth, video.videoHeight)
          }}
        />
      </div>
    </div>
  )
}
