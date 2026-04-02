import { useMediaPlayer } from '@/lib/use-media-player'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import {
  getDefaultPosition,
  useVideoPlayerPosition,
  validatePosition,
} from '@/lib/use-video-player-position'
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import Headphones from 'lucide-solid/icons/headphones'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import X from 'lucide-solid/icons/x'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { closePlayer, setAudioOnly } from '../lib/url-state-actions'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']

export function VideoPlayer(props: Props) {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const playingPath = createMemo(() => urlSearchParams().get('playing'))

  const audioOnly = createMemo(() => urlSearchParams().get('audioOnly') === 'true')

  const extension = createMemo(() => (playingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isVideoFile = createMemo(
    () => !!playingPath() && VIDEO_EXTENSIONS.includes(extension()) && !audioOnly(),
  )

  const mediaUrl = createMemo(() => {
    const path = playingPath()
    if (!path) return ''
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, path) : buildAdminMediaUrl(path)
  })

  const fileName = createMemo(() => (playingPath() || '').split('/').pop() || '')

  const [isMinimized, setIsMinimized] = createSignal(false)
  const [position, setPositionView] = createSignal(useVideoPlayerPosition.getState().position)

  onMount(() => {
    const unsub = useVideoPlayerPosition.subscribe((s) => {
      setPositionView(s.position)
    })
    onCleanup(unsub)
  })

  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()

  createEffect(() => {
    const path = playingPath()
    const url = mediaUrl()
    const vid = videoEl()
    if (!path || !isVideoFile() || !vid || !url) return

    useMediaPlayer.getState().setCurrentFile(path, 'video')

    const targetHref = new URL(url, window.location.origin).href
    const srcMismatch = vid.src !== targetHref

    const finish = () => {
      const st = useMediaPlayer.getState()
      const storeT = st.currentFile === path && st.mediaType === 'video' ? st.currentTime : 0
      const savedT = useVideoPlaybackTime.getState().getSavedTime(path) ?? 0
      const t = storeT > 0 ? storeT : savedT
      if (t > 0) {
        try {
          vid.currentTime = t
        } catch {
          /* ignore */
        }
      }
      void vid.play().catch(() => {})
    }

    let onCanPlay: () => void = () => {}

    if (srcMismatch) {
      onCanPlay = () => {
        vid.removeEventListener('canplay', onCanPlay)
        vid.removeEventListener('error', onCanPlay)
        finish()
      }
      vid.addEventListener('canplay', onCanPlay)
      vid.addEventListener('error', onCanPlay)
      vid.pause()
      vid.src = targetHref
      vid.load()
    } else {
      finish()
    }

    onCleanup(() => {
      vid.removeEventListener('canplay', onCanPlay)
      vid.removeEventListener('error', onCanPlay)
    })
  })

  createEffect(() => {
    const path = playingPath()
    const vid = videoEl()
    if (!path || !isVideoFile()) {
      if (vid) {
        vid.pause()
        vid.removeAttribute('src')
        vid.load()
      }
    }
  })

  function toggleMinimize() {
    const next = !isMinimized()
    setIsMinimized(next)

    if (next && typeof window !== 'undefined') {
      const store = useVideoPlayerPosition.getState()
      const pos = store.position
      const validatedPos = validatePosition(pos)
      if (pos.x === 0 && pos.y === 0) {
        store.setPosition(getDefaultPosition())
      } else if (validatedPos.x !== pos.x || validatedPos.y !== pos.y) {
        store.setPosition(validatedPos)
      }
    }
  }

  function handleAudioOnly() {
    const vid = videoEl()
    const path = playingPath()
    if (!path) return
    if (vid) {
      vid.pause()
      useMediaPlayer.getState().setCurrentTime(vid.currentTime)
    }
    setAudioOnly(true)
    useMediaPlayer.getState().setCurrentFile(path, 'audio')
    useMediaPlayer.getState().setIsPlaying(true)
  }

  function handleClose() {
    const vid = videoEl()
    if (vid) {
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
    closePlayer()
    setIsMinimized(false)
  }

  onCleanup(() => {
    const vid = videoEl()
    if (vid) {
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
  })

  const containerClass = () => (isMinimized() ? 'fixed z-40 w-80' : 'w-full bg-background')

  const containerStyle = (): Record<string, string | undefined> => {
    if (!isMinimized()) return {}
    const p = position()
    return { left: `${p.x}px`, top: `${p.y}px` }
  }

  const videoAreaStyle = (): Record<string, string | undefined> => {
    if (isMinimized()) {
      return {
        'max-height': '180px',
        'min-height': '180px',
        height: '180px',
      }
    }
    return { 'max-height': '70vh', 'aspect-ratio': '16 / 9' }
  }

  return (
    <Show when={isVideoFile() && playingPath()}>
      <div class={containerClass()} style={containerStyle()}>
        <div
          class={isMinimized() ? 'overflow-hidden rounded-lg border border-border shadow-lg' : ''}
        >
          <div class='bg-black'>
            <div class='border-border z-10 flex items-center justify-between border-b bg-background/90 p-2 backdrop-blur-sm'>
              <span class='flex-1 truncate px-2 text-sm font-medium'>{fileName()}</span>
              <div class='flex items-center gap-1'>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={() => handleAudioOnly()}
                  aria-label='Audio only mode'
                >
                  <Headphones class='h-4 w-4' size={16} stroke-width={2} />
                </button>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={() => toggleMinimize()}
                  aria-label={isMinimized() ? 'Maximize player' : 'Minimize player'}
                >
                  <Show
                    when={isMinimized()}
                    fallback={<Minimize2 class='h-4 w-4' size={16} stroke-width={2} />}
                  >
                    <Maximize2 class='h-4 w-4' size={16} stroke-width={2} />
                  </Show>
                </button>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={() => handleClose()}
                  aria-label='Close player'
                >
                  <X class='h-4 w-4' size={16} stroke-width={2} />
                </button>
              </div>
            </div>
            <video
              ref={(el) => {
                setVideoEl(el ?? undefined)
              }}
              controls
              class='w-full bg-black'
              style={videoAreaStyle()}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </div>
    </Show>
  )
}
