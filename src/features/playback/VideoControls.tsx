import { For, Show, createEffect, createMemo, createSignal, onSettled } from 'solid-js'
import type { Accessor } from 'solid-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import Play from 'lucide-solid/icons/play'
import Pause from 'lucide-solid/icons/pause'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import Maximize from 'lucide-solid/icons/maximize'
import Minimize from 'lucide-solid/icons/minimize'
import Settings2 from 'lucide-solid/icons/settings-2'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import Headphones from 'lucide-solid/icons/headphones'
import { post } from '@/lib/api/client'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { cn } from '@/lib/ui/cn'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PLAYBACK_MENU } from '@/lib/ui/floating-z-index'
import { usePlaybackSession, usePlaybackSnapshot } from './PlaybackProvider'
import { preferredTrack, videoInfoQuery, videoPreferencesQuery } from './video-source'
import type { VideoPreferences, VideoTrack } from './video-source'
import { parseSubtitles, subtitleText } from './subtitles'
import { PlaybackSetting } from './PlaybackSetting'
import { playbackItemFromPath } from './items'
import { createPlaybackScrubber } from './create-playback-scrubber'

type Props = {
  path: Accessor<string>
  video: Accessor<HTMLVideoElement | undefined>
  active: Accessor<boolean>
  onListenOnly?: () => void
}

function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(value / 3600)
  return `${hours ? `${hours}:` : ''}${String(Math.floor(value / 60) % 60).padStart(hours ? 2 : 1, '0')}:${String(value % 60).padStart(2, '0')}`
}

function trackLabel(track: VideoTrack): string {
  const language = track.language && track.language !== 'und' ? track.language.toUpperCase() : ''
  return [
    language,
    track.title || `Track ${(track.index ?? 0) + 1}`,
    track.codec.toUpperCase(),
    !track.supported ? '(unsupported)' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function VideoControls(props: Props) {
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()
  const queryClient = useQueryClient()
  const [visible, setVisible] = createSignal(true)
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const [uiError, setUiError] = createSignal('')
  const [settingsAnchor, setSettingsAnchor] = createSignal<HTMLButtonElement | null>(null)
  const [width, setWidth] = createSignal(0)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  const info = useQuery(() => ({ ...videoInfoQuery(props.path()), enabled: !!props.path() }))
  const preferences = useQuery(() => ({
    ...videoPreferencesQuery(props.path()),
    enabled: !!props.path(),
  }))
  const audio = createMemo(() =>
    preferredTrack(
      info.data?.audio ?? [],
      preferences.data?.video.audioTrack,
      preferences.data?.global.audioLanguage,
      true,
    ),
  )
  const primary = createMemo(() =>
    preferredTrack(
      info.data?.subtitles ?? [],
      preferences.data?.video.subtitleTrack,
      preferences.data?.global.subtitleLanguage,
    ),
  )
  const secondary = createMemo(() => {
    const track = preferredTrack(
      info.data?.subtitles ?? [],
      preferences.data?.video.secondarySubtitleTrack,
      preferences.data?.global.secondarySubtitleLanguage,
    )
    return track?.id === primary()?.id ? undefined : track
  })

  function subtitleQuery(track: VideoTrack | undefined) {
    const path = props.path()
    const id = track?.id ?? ''
    return {
      queryKey: ['video-subtitles', path, info.data?.fingerprint, id],
      enabled: !!path && !!id,
      staleTime: Infinity,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const response = await fetch(
          `/api/playback/subtitle?${new URLSearchParams({ path, track: id })}`,
          { signal },
        )
        if (!response.ok) {
          const error = (await response.json()) as { error?: string }
          throw new Error(error.error ?? 'Subtitles could not be loaded')
        }
        return parseSubtitles(await response.text())
      },
    }
  }
  const primaryCues = useQuery(() => subtitleQuery(primary()))
  const secondaryCues = useQuery(() => subtitleQuery(secondary()))
  const duration = createMemo(() =>
    props.active() ? snapshot().duration || info.data?.duration || 0 : info.data?.duration || 0,
  )
  const scrubber = createPlaybackScrubber({
    key: () => props.path(),
    position: () => (props.active() ? snapshot().position : 0),
    duration,
    onSeek: seek,
    onActivity: reveal,
  })
  const position = scrubber.position
  const primaryText = createMemo(() => subtitleText(primaryCues.data ?? [], position()))
  const secondaryText = createMemo(() => subtitleText(secondaryCues.data ?? [], position()))
  const playing = createMemo(() => props.active() && snapshot().desiredPlaying)
  const error = createMemo(() => (props.active() ? snapshot().error : null))
  const loading = createMemo(
    () => props.active() && (snapshot().phase === 'resolving' || snapshot().buffering),
  )

  const save = useMutation(() => ({
    mutationFn: (variables: {
      path: string
      video?: VideoPreferences['video']
      global?: VideoPreferences['global']
    }) => post<VideoPreferences>('/api/playback/preferences', variables),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(videoPreferencesQuery(variables.path).queryKey, data)
      void queryClient.invalidateQueries({ queryKey: ['playback-preferences'] })
    },
  }))

  createEffect(
    () => ({
      path: props.path(),
      active: props.active(),
      audio: audio()?.id,
      speed: preferences.data?.video.speed,
      ready: !!preferences.data && !!info.data,
    }),
    (() => {
      let previousPath = ''
      let previousAudio: string | undefined
      return ({
        path,
        active,
        audio: selected,
        speed,
        ready,
      }: {
        path: string
        active: boolean
        audio: string | undefined
        speed: number | undefined
        ready: boolean
      }) => {
        if (!active || !ready) return
        if (speed !== undefined && speed !== session.getSnapshot().playbackRate)
          session.dispatch({ type: 'setPlaybackRate', rate: speed })
        if (path === previousPath && selected !== previousAudio)
          session.dispatch({ type: 'refreshSource' })
        previousPath = path
        previousAudio = selected
      }
    })(),
  )

  function reveal(autoHide = playing() && !settingsOpen() && !focused() && !scrubber.active()) {
    setVisible(true)
    clearTimeout(hideTimer)
    if (autoHide) hideTimer = setTimeout(() => setVisible(false), 2500)
  }

  createEffect(
    () => ({
      playing: playing(),
      menu: settingsOpen(),
      focused: focused(),
      scrubbing: scrubber.active(),
    }),
    ({ playing, menu, focused, scrubbing }) => reveal(playing && !menu && !focused && !scrubbing),
  )
  createEffect(
    () => ({ element: props.video(), visible: visible(), menu: settingsOpen() }),
    ({ element, visible: shown, menu }) => {
      const container = element?.parentElement
      if (container) container.style.cursor = shown || menu ? '' : 'none'
    },
  )

  function seek(position: number) {
    const target = Math.max(0, Math.min(duration(), position))
    if (props.active()) session.dispatch({ type: 'seek', position: target })
    else
      session.dispatch({
        type: 'load',
        item: playbackItemFromPath(props.path(), 'video'),
        mode: 'video',
        autoplay: false,
        position: target,
      })
    reveal()
  }
  function toggle() {
    if (props.active()) session.dispatch({ type: 'toggle' })
    else
      session.dispatch({
        type: 'load',
        item: playbackItemFromPath(props.path(), 'video'),
        mode: 'video',
        autoplay: true,
      })
    reveal()
  }
  function toggleFullscreen() {
    const container = props.video()?.parentElement
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : container?.requestFullscreen()
    void request?.catch(() => setUiError('Fullscreen is unavailable in this browser window.'))
  }

  createEffect(
    () => props.video(),
    (video) => {
      const container = video?.parentElement
      if (!video || !container) return undefined
      const pointerMove = (event: PointerEvent) => {
        if (event.pointerType !== 'touch') reveal()
      }
      const pointerDown = () => {
        setFocused(false)
      }
      const focusIn = (event: FocusEvent) => {
        const keyboard = (event.target as HTMLElement).matches(':focus-visible')
        setFocused(keyboard)
        if (keyboard) reveal()
      }
      const focusOut = (event: FocusEvent) => {
        if (!container.contains(event.relatedTarget as Node | null)) setFocused(false)
      }
      const click = (event: MouseEvent) => {
        if (event.target !== video) return
        if (window.matchMedia('(pointer: coarse)').matches) {
          if (visible() && playing()) setVisible(false)
          else reveal()
        } else toggle()
      }
      const doubleClick = (event: MouseEvent) => {
        if (event.target === video) toggleFullscreen()
      }
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Tab') {
          setFocused(true)
          reveal()
          return
        }
        if (event.key === 'Escape' && settingsOpen()) {
          setSettingsOpen(false)
          event.preventDefault()
          return
        }
        const target = event.target as HTMLElement
        if (
          target.closest('input, select, textarea, button') ||
          target.isContentEditable ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return
        switch (event.key.toLowerCase()) {
          case ' ':
          case 'k':
            toggle()
            break
          case 'arrowleft':
            seek(position() - 5)
            break
          case 'arrowright':
            seek(position() + 5)
            break
          case 'j':
            seek(position() - 10)
            break
          case 'l':
            seek(position() + 10)
            break
          case 'f':
            toggleFullscreen()
            break
          case 'm':
            session.dispatch({ type: 'setMuted', muted: !snapshot().muted })
            break
          default:
            return
        }
        event.preventDefault()
        reveal()
      }
      const fullscreenChange = () => setFullscreen(document.fullscreenElement === container)
      const fullscreenKeyboard = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && settingsOpen()) {
          setSettingsOpen(false)
          settingsAnchor()?.focus()
          event.preventDefault()
        }
        if (document.fullscreenElement === container && event.key === 'Tab') {
          setFocused(true)
          reveal()
        }
      }
      const resize = new ResizeObserver(() => {
        setWidth(container.clientWidth)
      })
      resize.observe(container)
      container.addEventListener('pointermove', pointerMove)
      container.addEventListener('pointerdown', pointerDown)
      container.addEventListener('focusin', focusIn)
      container.addEventListener('focusout', focusOut)
      container.addEventListener('click', click)
      container.addEventListener('dblclick', doubleClick)
      container.addEventListener('keydown', keydown)
      document.addEventListener('fullscreenchange', fullscreenChange)
      document.addEventListener('keydown', fullscreenKeyboard)
      // eslint-disable-next-line solid/reactivity
      return () => {
        resize.disconnect()
        container.removeEventListener('pointermove', pointerMove)
        container.removeEventListener('pointerdown', pointerDown)
        container.removeEventListener('focusin', focusIn)
        container.removeEventListener('focusout', focusOut)
        container.removeEventListener('click', click)
        container.removeEventListener('dblclick', doubleClick)
        container.removeEventListener('keydown', keydown)
        document.removeEventListener('fullscreenchange', fullscreenChange)
        document.removeEventListener('keydown', fullscreenKeyboard)
      }
    },
  )

  onSettled(() => () => clearTimeout(hideTimer))

  function chooseTrack(
    kind: 'audioTrack' | 'subtitleTrack' | 'secondarySubtitleTrack',
    value: string,
  ) {
    const tracks = kind === 'audioTrack' ? info.data?.audio : info.data?.subtitles
    const selected = tracks?.find((track) => track.id === value)
    const languageKey =
      kind === 'audioTrack'
        ? 'audioLanguage'
        : kind === 'subtitleTrack'
          ? 'subtitleLanguage'
          : 'secondarySubtitleLanguage'
    save.mutate({
      path: props.path(),
      video: { [kind]: value || null },
      global: { [languageKey]: selected?.language === 'und' ? '' : (selected?.language ?? '') },
    })
  }

  const buttonClass =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'

  return (
    <>
      <div
        class='pointer-events-none absolute inset-x-3 z-10 flex flex-col items-center gap-1 text-center font-medium text-white'
        style={{
          bottom: visible() ? '5.75rem' : '1.25rem',
          'font-size': 'clamp(16px, 2.2vw, 28px)',
          'text-shadow': '0 1px 3px black, 0 0 4px black',
        }}
        data-testid='video-subtitles'
      >
        <Show when={secondaryText()}>
          <div
            class='max-w-[92%] whitespace-pre-line rounded bg-black/60 px-2 py-0.5 text-[0.85em]'
            data-testid='video-subtitle-secondary'
          >
            {secondaryText()}
          </div>
        </Show>
        <Show when={primaryText()}>
          <div
            class='max-w-[92%] whitespace-pre-line rounded bg-black/60 px-2 py-0.5'
            data-testid='video-subtitle-primary'
          >
            {primaryText()}
          </div>
        </Show>
      </div>
      <Show when={loading() && !error()}>
        <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center'>
          <LoaderCircle class='h-8 w-8 animate-spin text-white' />
        </div>
      </Show>
      <Show when={error()}>
        {(message) => (
          <div
            class='absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-5 text-center text-white'
            role='alert'
          >
            <p class='max-w-lg text-sm'>{message()}</p>
            <div class='flex gap-3'>
              <button
                type='button'
                class='rounded-md bg-white px-3 py-2 text-sm text-black'
                onClick={() => session.dispatch({ type: 'retry' })}
              >
                Retry
              </button>
              <a
                class='rounded-md border border-white/40 px-3 py-2 text-sm'
                href={fileDownloadHref(props.path())}
                download
              >
                Download
              </a>
            </div>
          </div>
        )}
      </Show>
      <div
        class={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-150 ${visible() ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        data-testid='video-controls'
        aria-hidden={visible() ? 'false' : 'true'}
      >
        <FloatingContextMenu
          open={settingsOpen}
          anchorRef={settingsAnchor}
          onDismiss={() => setSettingsOpen(false)}
          mount={fullscreen() ? (props.video()?.parentElement ?? document.body) : document.body}
          role='presentation'
          zIndex={FLOATING_Z_PLAYBACK_MENU - 1}
          class='max-h-[min(80dvh,420px)] w-[min(340px,calc(100vw-2rem))] overflow-y-auto rounded-lg p-3'
        >
          <div role='dialog' aria-label='Playback settings'>
            <div class='mb-3 flex items-center justify-between'>
              <span class='text-sm font-semibold'>Playback settings</span>
              <button
                type='button'
                class='rounded px-2 py-1 text-sm hover:bg-accent'
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
            <div class='space-y-3'>
              <label class='block space-y-1 text-xs'>
                <span>Speed</span>
                <PlaybackSetting
                  label='Playback speed'
                  value={String(
                    props.active() ? snapshot().playbackRate : (preferences.data?.video.speed ?? 1),
                  )}
                  mount={fullscreen() ? (props.video()?.parentElement ?? undefined) : undefined}
                  options={Array.from({ length: 12 }, (_, index) => {
                    const rate = (index + 1) / 4
                    return {
                      value: String(rate),
                      label: `${rate}×${rate === 1 ? ' · Normal' : ''}`,
                    }
                  })}
                  onChange={(value) => {
                    const speed = Number(value)
                    if (props.active()) session.dispatch({ type: 'setPlaybackRate', rate: speed })
                    save.mutate({ path: props.path(), video: { speed } })
                  }}
                />
              </label>
              <label class='block space-y-1 text-xs'>
                <span>Audio</span>
                <PlaybackSetting
                  label='Audio track'
                  value={audio()?.id ?? ''}
                  mount={fullscreen() ? (props.video()?.parentElement ?? undefined) : undefined}
                  options={
                    info.data?.audio.length
                      ? info.data.audio.map((track) => ({
                          value: track.id,
                          label: trackLabel(track),
                        }))
                      : [{ value: '', label: 'No audio tracks' }]
                  }
                  disabled={!info.data?.audio.length || save.isPending}
                  onChange={(value) => chooseTrack('audioTrack', value)}
                />
              </label>
              <For each={['subtitleTrack', 'secondarySubtitleTrack'] as const}>
                {(kind) => (
                  <label class='block space-y-1 text-xs'>
                    <span>{kind === 'subtitleTrack' ? 'Subtitles' : 'Second subtitles'}</span>
                    <PlaybackSetting
                      label={kind === 'subtitleTrack' ? 'Subtitles' : 'Second subtitles'}
                      value={(kind === 'subtitleTrack' ? primary() : secondary())?.id ?? ''}
                      mount={fullscreen() ? (props.video()?.parentElement ?? undefined) : undefined}
                      options={[
                        { value: '', label: 'Off' },
                        ...(info.data?.subtitles ?? []).map((track) => ({
                          value: track.id,
                          label: trackLabel(track),
                          disabled: !track.supported,
                        })),
                      ]}
                      disabled={save.isPending}
                      onChange={(value) => chooseTrack(kind, value)}
                    />
                  </label>
                )}
              </For>
              <Show when={info.isError}>
                <p class='text-destructive text-xs'>
                  Track information is unavailable. FFmpeg and ffprobe are required on the server.
                </p>
              </Show>
              <Show when={save.error || primaryCues.error || secondaryCues.error || uiError()}>
                <p class='text-destructive text-xs' role='alert'>
                  {save.error?.message ??
                    primaryCues.error?.message ??
                    secondaryCues.error?.message ??
                    uiError()}
                </p>
              </Show>
            </div>
          </div>
        </FloatingContextMenu>
        <div class='border-border bg-background text-foreground border-t px-2 py-1.5'>
          <input
            type='range'
            aria-label='Seek video'
            aria-valuetext={`${timeLabel(position())} of ${timeLabel(duration())}`}
            class='video-slider block w-full'
            style={{ '--video-progress': `${duration() ? (position() / duration()) * 100 : 0}%` }}
            min='0'
            max={duration() || 1}
            step='0.1'
            value={position()}
            {...scrubber.handlers}
          />
          <div class='flex flex-wrap items-center gap-1'>
            <button
              type='button'
              class={cn(buttonClass, 'bg-primary text-primary-foreground hover:bg-primary/90')}
              aria-label={playing() ? 'Pause video' : 'Play video'}
              onClick={toggle}
            >
              <Show when={playing()} fallback={<Play class='h-4 w-4' />}>
                <Pause class='h-4 w-4' />
              </Show>
            </button>
            <button
              type='button'
              class={buttonClass}
              aria-label={snapshot().muted ? 'Unmute video' : 'Mute video'}
              onClick={() => session.dispatch({ type: 'setMuted', muted: !snapshot().muted })}
            >
              <Show when={!snapshot().muted} fallback={<VolumeX class='h-4 w-4' />}>
                <Volume2 class='h-4 w-4' />
              </Show>
            </button>
            <Show when={width() >= 480}>
              <input
                type='range'
                aria-label='Video volume'
                class='video-slider w-20'
                style={{ '--video-progress': `${snapshot().muted ? 0 : snapshot().volume * 100}%` }}
                min='0'
                max='1'
                step='0.01'
                value={snapshot().muted ? 0 : snapshot().volume}
                onInput={(event) =>
                  session.dispatch({ type: 'setVolume', volume: Number(event.currentTarget.value) })
                }
              />
            </Show>
            <span class='ml-1 whitespace-nowrap text-xs tabular-nums'>
              {timeLabel(position())} / {timeLabel(duration())}
            </span>
            <div class='flex-1' />
            <Show when={props.onListenOnly}>
              <button
                type='button'
                class={buttonClass}
                aria-label='Listen only'
                title='Listen only'
                onClick={() => props.onListenOnly?.()}
              >
                <Headphones class='h-4 w-4' />
              </button>
            </Show>
            <Show when={snapshot().playbackRate !== 1}>
              <span class='text-muted-foreground text-xs'>{snapshot().playbackRate}×</span>
            </Show>
            <button
              type='button'
              class={buttonClass}
              ref={setSettingsAnchor}
              aria-label='Playback settings'
              aria-expanded={settingsOpen() ? 'true' : 'false'}
              onClick={() => {
                setSettingsOpen((value) => !value)
                reveal()
              }}
            >
              <Settings2 class='h-4 w-4' />
            </button>
            <button
              type='button'
              class={buttonClass}
              aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={toggleFullscreen}
            >
              <Show when={fullscreen()} fallback={<Maximize class='h-4 w-4' />}>
                <Minimize class='h-4 w-4' />
              </Show>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
