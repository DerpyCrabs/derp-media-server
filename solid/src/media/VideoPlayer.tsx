import { useMediaPlayer } from '@/lib/use-media-player'
import { Show, createEffect, createMemo, onCleanup } from 'solid-js'
import X from 'lucide-solid/icons/x'
import { useBrowserHistory } from '../browser-history'
import { closePlayer } from '../lib/url-state-actions'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']

export function VideoPlayer(props: Props) {
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

  let videoRef: HTMLVideoElement | undefined

  createEffect(() => {
    const path = playingPath()
    const url = mediaUrl()
    const vid = videoRef
    if (!path || !isVideoFile() || !vid || !url) return

    useMediaPlayer.getState().setCurrentFile(path, 'video')

    if (vid.src !== new URL(url, window.location.origin).href) {
      vid.src = url
      void vid.load()
    }

    const play = () => {
      void vid.play().catch(() => {})
    }
    void play()
  })

  createEffect(() => {
    const path = playingPath()
    if (!path || !isVideoFile()) {
      const vid = videoRef
      if (vid) {
        vid.pause()
        vid.removeAttribute('src')
        void vid.load()
      }
    }
  })

  function handleClose() {
    const vid = videoRef
    if (vid) {
      vid.pause()
      vid.removeAttribute('src')
      void vid.load()
    }
    closePlayer()
  }

  onCleanup(() => {
    const vid = videoRef
    if (vid) {
      vid.pause()
      vid.removeAttribute('src')
    }
  })

  return (
    <Show when={isVideoFile() && playingPath()}>
      <div class='w-full bg-background'>
        <div class='bg-black'>
          <div class='border-border z-10 flex items-center justify-between border-b bg-background/90 p-2 backdrop-blur-sm'>
            <span class='flex-1 truncate px-2 text-sm font-medium'>{fileName()}</span>
            <button
              type='button'
              class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
              onClick={() => handleClose()}
              aria-label='Close player'
            >
              <X class='h-4 w-4' size={16} stroke-width={2} />
            </button>
          </div>
          <video
            ref={(el) => {
              videoRef = el
            }}
            controls
            class='w-full bg-black'
            style={{ 'max-height': '70vh', 'aspect-ratio': '16 / 9' }}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </Show>
  )
}
