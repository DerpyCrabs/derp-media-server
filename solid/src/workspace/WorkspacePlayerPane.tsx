import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import { MediaType } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import type { WorkspaceShareConfig } from './WorkspaceBrowserPane'

const VIDEO_EXT = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'])

function isVideoPath(p: string | null): boolean {
  if (!p) return false
  const ext = p.split('.').pop()?.toLowerCase()
  return ext ? VIDEO_EXT.has(ext) : false
}

type Props = {
  windowId: string
  storageKey: string
  window: Accessor<WorkspaceWindowDefinition | undefined>
  shareFallback: Accessor<WorkspaceShareConfig | null>
}

export function WorkspacePlayerPane(props: Props) {
  let videoRef: HTMLVideoElement | undefined

  const [playing, setPlaying] = createSignal<string | null>(null)
  const [audioOnly, setAudioOnly] = createSignal(false)

  onMount(() => {
    const read = () => {
      const sl = useWorkspacePlaybackStore.getState().byKey[props.storageKey]
      setPlaying(sl?.playing ?? null)
      setAudioOnly(sl?.audioOnly ?? false)
    }
    read()
    const unsub = useWorkspacePlaybackStore.subscribe(read)
    onCleanup(unsub)
  })

  const showVideo = createMemo(() => isVideoPath(playing()) && !audioOnly())

  const mediaUrl = createMemo(() => {
    const path = playing()
    if (!path) return ''
    const w = props.window()
    if (w?.source.kind === 'share' && w.source.token) {
      return buildShareMediaUrl(w.source.token, w.source.sharePath ?? '', path)
    }
    const fb = props.shareFallback()
    if (fb) return buildShareMediaUrl(fb.token, fb.sharePath, path)
    return buildAdminMediaUrl(path)
  })

  createEffect(() => {
    const path = playing()
    const url = mediaUrl()
    const vid = videoRef
    if (!path || !showVideo() || !vid || !url) return

    useMediaPlayer.getState().setCurrentFile(path, 'video')

    const abs = new URL(url, window.location.origin).href
    if (vid.src !== abs) {
      vid.src = url
      void vid.load()
    }
    void vid.play().catch(() => {})
  })

  return (
    <div
      data-no-window-drag
      class='relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black/80'
    >
      <Show
        when={showVideo()}
        fallback={
          <div class='text-muted-foreground flex h-full items-center justify-center p-4 text-sm'>
            No video
          </div>
        }
      >
        <video
          ref={videoRef}
          class='h-full w-full object-contain'
          controls
          playsinline
          data-media-type={MediaType.VIDEO}
        />
      </Show>
    </div>
  )
}
