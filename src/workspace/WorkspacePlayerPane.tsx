import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import { isVideoPath } from '@/lib/workspace-geometry'
import { MediaType } from '@/lib/types'
import Headphones from 'lucide-solid/icons/headphones'
import MonitorPlay from 'lucide-solid/icons/monitor-play'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import type { WorkspaceShareConfig } from './WorkspaceBrowserPane'

type Props = {
  windowId: string
  storageKey: string
  window: Accessor<WorkspaceWindowDefinition | undefined>
  shareFallback: Accessor<WorkspaceShareConfig | null>
  onVideoMetadataLoaded?: (videoWidth: number, videoHeight: number) => void
}

export function WorkspacePlayerPane(props: Props) {
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()

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

  const playingIsVideo = createMemo(() => {
    const p = playing()
    return p ? isVideoPath(p) : false
  })
  const showVideo = createMemo(() => playingIsVideo() && !audioOnly())

  const mediaUrl = createMemo(() => {
    const path = playing()
    if (!path) return ''
    const w = props.window()
    if (w?.source.kind === 'share' && w.source.token) {
      const fb = props.shareFallback()
      const sharePath =
        (w.source.sharePath ?? '').trim() ||
        (fb && fb.token === w.source.token ? (fb.sharePath ?? '').trim() : '')
      return buildShareMediaUrl(w.source.token, sharePath, path)
    }
    const fb = props.shareFallback()
    if (fb) return buildShareMediaUrl(fb.token, fb.sharePath, path)
    return buildAdminMediaUrl(path)
  })

  createEffect(() => {
    const path = playing()
    const url = mediaUrl()
    const vid = videoEl()
    if (!path || !showVideo() || !vid || !url) return

    useMediaPlayer.getState().setCurrentFile(path, 'video')

    const abs = new URL(url, window.location.origin).href
    if (vid.src !== abs) {
      vid.src = url
      vid.load()
    }
    void vid.play().catch(() => {})
  })

  const fileName = createMemo(() => (playing() || '').split('/').pop() || 'Video Player')

  function setWorkspaceAudioOnly(enabled: boolean) {
    useWorkspacePlaybackStore.getState().setAudioOnly(props.storageKey, enabled)
  }

  return (
    <div
      data-no-window-drag
      class='absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-black/80'
    >
      <Show
        when={playingIsVideo()}
        fallback={
          <div class='bg-muted/20 flex h-full items-center justify-center p-6 text-center'>
            <div class='space-y-3'>
              <div class='bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full'>
                <MonitorPlay class='text-muted-foreground h-6 w-6' stroke-width={2} />
              </div>
              <div class='text-sm font-medium'>No video is playing</div>
              <div class='text-muted-foreground text-sm'>
                Start a video from any browser window to open it here.
              </div>
            </div>
          </div>
        }
      >
        <Show
          when={audioOnly()}
          fallback={
            <div class='group relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
              <div class='absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100'>
                <button
                  type='button'
                  title='Listen only'
                  class='bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md'
                  onClick={() => setWorkspaceAudioOnly(true)}
                >
                  <Headphones class='h-4 w-4' stroke-width={2} />
                </button>
              </div>
              <video
                ref={(el) => setVideoEl(el ?? undefined)}
                class='min-h-0 w-full flex-1 bg-black object-contain'
                controls
                playsinline
                data-media-type={MediaType.VIDEO}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (v.videoWidth > 0 && v.videoHeight > 0) {
                    props.onVideoMetadataLoaded?.(v.videoWidth, v.videoHeight)
                  }
                }}
              />
            </div>
          }
        >
          <div class='bg-muted/20 flex h-full items-center justify-center p-6 text-center'>
            <div class='space-y-3'>
              <div class='bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full'>
                <Headphones class='text-muted-foreground h-6 w-6' stroke-width={2} />
              </div>
              <div class='text-sm font-medium'>{fileName()} is playing in audio mode</div>
              <div class='text-muted-foreground text-sm'>
                Restore video playback from the taskbar audio controls or here.
              </div>
              <div>
                <button
                  type='button'
                  class='border-input bg-background hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm'
                  onClick={() => setWorkspaceAudioOnly(false)}
                >
                  <MonitorPlay class='h-4 w-4' stroke-width={2} />
                  Show video
                </button>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}
