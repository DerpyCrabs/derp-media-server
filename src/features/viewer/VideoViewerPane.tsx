import { createEffect, createMemo, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import { VideoControls } from '@/features/playback/VideoControls'
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
  const active = createMemo(() => {
    const state = playback()
    return (
      state.mode === 'video' &&
      state.currentItem?.media === 'video' &&
      playbackPathMatches(state.currentItem, props.viewingPath())
    )
  })
  const fileName = createMemo(() => props.viewingPath().split(/[/\\]/).pop() ?? 'file')

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

  const attachmentTarget = createMemo(
    () => {
      const video = element()
      const path = props.viewingPath()
      return video && path && props.contentVisible() && active() ? { video, path } : null
    },
    { equals: (left, right) => left?.video === right?.video && left?.path === right?.path },
  )
  createEffect(attachmentTarget, (attachment) => {
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
  })

  function listenOnly() {
    const path = props.viewingPath()
    if (!path) return
    const position = active() ? playback().position : 0
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
      <div class='video-surface relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
        <video
          ref={(video) => setElement(video ?? undefined)}
          class='min-h-0 w-full flex-1 bg-black object-contain'
          playsinline
          tabindex='0'
          data-media-type={MediaType.VIDEO}
          data-playback-media-host={active() && props.contentVisible() ? 'video' : undefined}
          data-playback-source={active() ? playback().source?.url : undefined}
          title={fileName()}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            if (video.videoWidth > 0 && video.videoHeight > 0)
              props.onMetadataLoaded?.(video.videoWidth, video.videoHeight)
          }}
        />
        <VideoControls
          path={props.viewingPath}
          video={element}
          active={active}
          onListenOnly={props.showListenOnly ? listenOnly : undefined}
        />
      </div>
    </div>
  )
}
