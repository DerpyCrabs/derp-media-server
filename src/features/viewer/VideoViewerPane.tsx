import { domBinding, modelOwner, view, type Snapshot, controllerView } from 'effectweb'
import { VideoControls } from '@/features/playback/VideoControls'
import { MediaType } from '@/lib/files/types'
import { playbackItemFromPath, playbackPathKey, playbackPathMatches } from '@/features/playback'
import {
  getPlaybackMediaHost,
  getPlaybackSession,
  playbackSource,
} from '@/features/playback/PlaybackProvider'
type Props = {
  viewingPath: string
  contentVisible: boolean
  autoplay: boolean
  showListenOnly: boolean
  onMetadataLoaded?: (width: number, height: number) => void
  onListenOnly?: () => void
}
function videoController(props: Snapshot<Props>) {
  const session = getPlaybackSession(),
    host = getPlaybackMediaHost()
  let offeredPath = '',
    attachedPath = ''
  let detach: (() => void) | undefined
  let video: HTMLVideoElement | undefined
  const owner = modelOwner({
    props,
    playback: playbackSource.model(),
    video: undefined as HTMLVideoElement | undefined,
  })
  const actions = {
    attach: (element: HTMLVideoElement) => {
      video = element
      owner.patch({ video: element })
      sync()
    },
    listenOnly: () => {
      const current = owner.read(),
        path = current.props.viewingPath
      if (!path) return
      if (
        playbackPathMatches(current.playback.currentItem, path) &&
        current.playback.mode === 'video'
      ) {
        session.dispatch({ type: 'setMode', mode: 'audio' })
        session.dispatch({ type: 'play' })
      } else
        session.dispatch({
          type: 'load',
          item: playbackItemFromPath(path, 'video'),
          autoplay: true,
          position: 0,
          mode: 'audio',
        })
      current.props.onListenOnly?.()
    },
  }
  const release = () => {
    if (!detach) return
    const current = session.getSnapshot()
    if (
      current.mode === 'video' &&
      current.desiredPlaying &&
      playbackPathMatches(current.currentItem, attachedPath)
    )
      session.dispatch({ type: 'pause' })
    detach()
    detach = undefined
    attachedPath = ''
  }
  const sync = () => {
    const current = owner.read(),
      next = current.props
    const key = next.viewingPath ? playbackPathKey(next.viewingPath) : ''
    if (key && next.contentVisible && offeredPath !== key) {
      offeredPath = key
      if (
        !playbackPathMatches(current.playback.currentItem, next.viewingPath) &&
        (!current.playback.currentItem || next.autoplay)
      )
        session.dispatch({
          type: 'load',
          item: playbackItemFromPath(next.viewingPath, 'video'),
          autoplay: next.autoplay,
          mode: 'video',
        })
    }
    const active =
      current.playback.mode === 'video' &&
      current.playback.currentItem?.media === 'video' &&
      playbackPathMatches(current.playback.currentItem, next.viewingPath)
    if (!video || !next.contentVisible || !active) {
      release()
      return
    }
    if (attachedPath !== next.viewingPath) {
      release()
      attachedPath = next.viewingPath
      detach = host.attach(video, 'video')
    }
  }
  owner.own(
    playbackSource.subscribe((playback) => {
      owner.patch({ playback })
      sync()
    }),
  )
  sync()
  return {
    source: owner.source,
    ...actions,
    receive: (next: Snapshot<Props>) => {
      owner.patch({ props: next })
      sync()
    },
    dispose: () => {
      release()
      owner.dispose()
    },
  }
}
const attachVideo = (element: HTMLVideoElement, current: () => (video: HTMLVideoElement) => void) =>
  current()(element)
export const VideoViewerPane = controllerView(
  { controller: videoController },
  view((model) => {
    const props = model.props
    const active =
      model.playback.mode === 'video' &&
      model.playback.currentItem?.media === 'video' &&
      playbackPathMatches(model.playback.currentItem, props.viewingPath)
    return (
      <div class='flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-black'>
        <div class='video-surface relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
          <video
            use={domBinding(model.actions.attach, attachVideo)}
            class='min-h-0 w-full flex-1 bg-black object-contain'
            playsinline
            tabindex={0}
            data-media-type={MediaType.VIDEO}
            data-playback-media-host={active && props.contentVisible ? 'video' : undefined}
            data-playback-source={active ? model.playback.source?.url : undefined}
            title={props.viewingPath.split(/[/\\]/).pop() ?? 'file'}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget
              if (video.videoWidth > 0 && video.videoHeight > 0)
                props.onMetadataLoaded?.(video.videoWidth, video.videoHeight)
            }}
          />
          <VideoControls
            path={props.viewingPath}
            video={model.video}
            active={active}
            onListenOnly={props.showListenOnly ? model.actions.listenOnly : undefined}
          />
        </div>
      </div>
    )
  }),
)
