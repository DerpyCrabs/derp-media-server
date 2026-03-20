import { useMediaPlayer } from '@/lib/use-media-player'
import { Show, createEffect, createMemo, onCleanup } from 'solid-js'
import { useBrowserHistory } from '../browser-history'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']

/** Minimal audio element so `playing` URLs for audio keep playback in parity with React. */
export function AudioPlayer(props: Props) {
  const history = useBrowserHistory()

  const playingPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('playing')
  })

  const audioOnly = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('audioOnly') === 'true'
  })

  const extension = createMemo(() => (playingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isAudioFile = createMemo(() => !!playingPath() && AUDIO_EXTENSIONS.includes(extension()))
  const isVideoFile = createMemo(() => !!playingPath() && VIDEO_EXTENSIONS.includes(extension()))
  const shouldPlayAudio = createMemo(
    () => !!(playingPath() && (isAudioFile() || (isVideoFile() && audioOnly()))),
  )

  const mediaUrl = createMemo(() => {
    const path = playingPath()
    if (!path) return ''
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, path) : buildAdminMediaUrl(path)
  })

  let audioRef: HTMLAudioElement | undefined

  createEffect(() => {
    const path = playingPath()
    const url = mediaUrl()
    const audio = audioRef
    if (!path || !shouldPlayAudio() || !audio || !url) return

    useMediaPlayer.getState().setCurrentFile(path, 'audio')

    if (audio.src !== new URL(url, window.location.origin).href) {
      audio.src = url
      void audio.load()
    }
    void audio.play().catch(() => {})
  })

  createEffect(() => {
    if (!shouldPlayAudio()) {
      const audio = audioRef
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
        void audio.load()
      }
    }
  })

  onCleanup(() => {
    const audio = audioRef
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
    }
  })

  return (
    <Show when={shouldPlayAudio() && playingPath()}>
      <audio
        ref={(el) => {
          audioRef = el
        }}
        class='sr-only'
        controls
        preload='auto'
      />
    </Show>
  )
}
