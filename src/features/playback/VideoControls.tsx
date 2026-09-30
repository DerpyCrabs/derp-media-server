import { playbackStatusSchema } from './playback-schemas'
import { Schema, Option } from 'effect'
import { videoPreferencesSchema } from './playback-schemas'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
  available,
  commandSlot,
  domBinding,
  modelOwner,
  resourceError,
  view,
  type Snapshot,
  controllerView,
  type ControllerModel,
  ownedTasks,
} from 'effectweb'
import { queryCache, groups } from '@/lib/api/cache'
import { postSchemaEffect } from '@/lib/api/client'
import Play from '@effectweb/lucide/icons/play'
import Pause from '@effectweb/lucide/icons/pause'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import VolumeX from '@effectweb/lucide/icons/volume-x'
import Maximize from '@effectweb/lucide/icons/maximize'
import Minimize from '@effectweb/lucide/icons/minimize'
import Settings2 from '@effectweb/lucide/icons/settings-2'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import Headphones from '@effectweb/lucide/icons/headphones'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { cn } from '@/lib/ui/cn'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PLAYBACK_MENU } from '@/lib/ui/floating-z-index'
import { getPlaybackSession, playbackSource } from './PlaybackProvider'
import {
  preferredTrack,
  videoInfoQuery,
  videoPreferencesQuery,
  type VideoInfo,
  type VideoPreferences,
  type VideoTrack,
} from './video-source'
import { parseSubtitles, subtitleText } from './subtitles'
import { PlaybackSetting } from './PlaybackSetting'
import { playbackItemFromPath } from './items'
import { PlaybackScrubber } from './create-playback-scrubber'
import { observeQuery, query } from '@effectweb/query'
type Props = {
  path: string
  video: HTMLVideoElement | undefined
  active: boolean
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
const hideSlot = commandSlot('video-controls-hide')
const saveSlot = commandSlot('video-preferences-save')
const fullscreenSlot = commandSlot('video-fullscreen')
function controlsController(props: Snapshot<Props>) {
  const session = getPlaybackSession()
  let previousPath = '',
    previousAudio: string | undefined,
    hideKey = ''
  const owner = modelOwner({
    props,
    playback: playbackSource.model(),
    visible: true,
    settingsOpen: false,
    fullscreen: false,
    focused: false,
    scrubbing: false,
    uiError: '',
    settingsAnchor: null as HTMLButtonElement | null,
    width: 0,
    container: undefined as HTMLElement | undefined,
    info: undefined as VideoInfo | undefined,
    preferences: undefined as VideoPreferences | undefined,
    infoError: false,
    saved: AsyncResult.initial() as AsyncResult.AsyncResult<unknown, unknown>,
  })
  const { save } = ownedTasks(owner, {
    save: {
      policy: 'queue',
      slot: saveSlot,
      result: 'saved',
      run: (video: VideoPreferences['video'], global?: VideoPreferences['global']) => {
        const path = owner.read().props.path
        return postSchemaEffect(videoPreferencesSchema, '/api/playback/preferences', {
          path,
          video,
          global,
        }).pipe(
          Effect.tap((preferences) =>
            Effect.sync(() => {
              queryCache.setQueryData(videoPreferencesQuery, path, preferences)
              queryCache.invalidateGroup(groups.playback)
            }),
          ),
        )
      },
    },
  })
  const actions = {
    reveal: () => reveal(),
    toggle: () => {
      const current = owner.read()
      if (current.props.active) session.dispatch({ type: 'toggle' })
      else
        session.dispatch({
          type: 'load',
          item: playbackItemFromPath(current.props.path, 'video'),
          mode: 'video',
          autoplay: true,
        })
      reveal()
    },
    seek: (position: number) => {
      const current = owner.read(),
        duration =
          (current.props.active ? current.playback.duration : 0) || current.info?.duration || 0
      const target = Math.max(0, Math.min(duration, position))
      if (current.props.active) session.dispatch({ type: 'seek', position: target })
      else
        session.dispatch({
          type: 'load',
          item: playbackItemFromPath(current.props.path, 'video'),
          mode: 'video',
          autoplay: false,
          position: target,
        })
      reveal()
    },
    fullscreen: () =>
      owner.run(
        fullscreenSlot,
        Effect.suspend(() => {
          const container = owner.read().props.video?.parentElement
          if (document.fullscreenElement)
            return Effect.tryPromise({
              try: () => document.exitFullscreen(),
              catch: (error) => error,
            })
          return container
            ? Effect.tryPromise({
                try: () => container.requestFullscreen(),
                catch: (error) => error,
              })
            : Effect.void
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() =>
              owner.patch({ uiError: 'Fullscreen is unavailable in this browser window.' }),
            ),
          ),
        ),
        'drop',
      ),
    focused: (focused: boolean) => {
      owner.patch({ focused })
      syncHide()
    },
    scrubbing: (scrubbing: boolean) => {
      owner.patch({ scrubbing })
      syncHide()
    },
    visible: (visible: boolean) => owner.patch({ visible }),
    settings: (settingsOpen: boolean, settingsAnchor = owner.read().settingsAnchor) => {
      owner.patch({ settingsOpen, settingsAnchor })
      syncHide()
    },
    metrics: (fullscreen: boolean, width: number, container: HTMLElement) =>
      owner.patch({ fullscreen, width, container }),
    mute: () => {
      session.dispatch({ type: 'setMuted', muted: !session.getSnapshot().muted })
    },
    volume: (volume: number) => {
      session.dispatch({ type: 'setVolume', volume })
    },
    retry: () => {
      session.dispatch({ type: 'retry' })
    },
    speed: (speed: number) => {
      if (owner.read().props.active) session.dispatch({ type: 'setPlaybackRate', rate: speed })
      save({ speed })
    },
    track: (kind: 'audioTrack' | 'subtitleTrack' | 'secondarySubtitleTrack', value: string) => {
      const current = owner.read(),
        tracks = kind === 'audioTrack' ? current.info?.audio : current.info?.subtitles
      const selected = tracks?.find((track) => track.id === value)
      const languageKey =
        kind === 'audioTrack'
          ? 'audioLanguage'
          : kind === 'subtitleTrack'
            ? 'subtitleLanguage'
            : 'secondarySubtitleLanguage'
      save(
        { [kind]: value || null },
        { [languageKey]: selected?.language === 'und' ? '' : (selected?.language ?? '') },
      )
    },
  }
  const reveal = () => {
    const current = owner.read()
    owner.patch({ visible: true })
    owner.cancel(hideSlot)
    if (
      current.props.active &&
      current.playback.desiredPlaying &&
      !current.settingsOpen &&
      !current.focused &&
      !current.scrubbing
    )
      owner.run(
        hideSlot,
        Effect.sleep(2500).pipe(Effect.andThen(Effect.sync(() => owner.patch({ visible: false })))),
        'replace',
      )
  }
  const syncHide = () => {
    const current = owner.read()
    const key = `${current.props.active && current.playback.desiredPlaying}:${current.settingsOpen}:${current.focused}:${current.scrubbing}`
    if (hideKey !== key) {
      hideKey = key
      reveal()
    }
  }
  const syncPreferences = () => {
    const current = owner.read()
    if (!current.props.active || !current.preferences || !current.info) return
    const selected = preferredTrack(
      current.info.audio,
      current.preferences.video.audioTrack,
      current.preferences.global.audioLanguage,
      true,
    )?.id
    const changed = current.props.path === previousPath && selected !== previousAudio
    previousPath = current.props.path
    previousAudio = selected
    const speed = current.preferences.video.speed
    if (speed !== undefined && speed !== session.getSnapshot().playbackRate)
      session.dispatch({ type: 'setPlaybackRate', rate: speed })
    if (changed) session.dispatch({ type: 'refreshSource' })
  }
  const info = observeQuery(owner, queryCache, videoInfoQuery, (result) => {
    owner.patch({ info: available(result), infoError: !!resourceError(result) })
    syncPreferences()
  })
  const preferences = observeQuery(owner, queryCache, videoPreferencesQuery, (result) => {
    owner.patch({ preferences: available(result) })
    syncPreferences()
  })
  owner.own(
    playbackSource.subscribe((playback) => {
      owner.patch({ playback })
      syncHide()
    }),
  )
  info.select(props.path || undefined)
  preferences.select(props.path || undefined)
  syncHide()
  return {
    source: owner.source,
    actions,
    receive: (next: Snapshot<Props>) => {
      owner.patch({ props: next })
      info.select(next.path || undefined)
      preferences.select(next.path || undefined)
      syncPreferences()
      syncHide()
    },
    dispose: owner.dispose,
  }
}
type ControlsModel = ControllerModel<typeof controlsController>
const controlsBehavior = (_element: HTMLSpanElement, current: () => ControlsModel) => {
  let attached: HTMLVideoElement | undefined
  let cleanup: (() => void) | undefined
  const attach = () => {
    const video = current().props.video
    if (video === attached) {
      const container = video?.parentElement
      if (container)
        container.style.cursor = current().visible || current().settingsOpen ? '' : 'none'
      return
    }
    cleanup?.()
    attached = video
    const container = video?.parentElement
    if (!video || !container) return
    const reveal = () => current().actions.reveal()
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') reveal()
    }
    const pointerDown = () => current().actions.focused(false)
    const focusIn = (event: FocusEvent) => {
      const keyboard = (event.target as HTMLElement).matches(':focus-visible')
      current().actions.focused(keyboard)
      if (keyboard) reveal()
    }
    const focusOut = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node | null)) current().actions.focused(false)
    }
    const click = (event: MouseEvent) => {
      if (event.target !== video) return
      const model = current()
      if (window.matchMedia('(pointer: coarse)').matches) {
        if (model.visible && model.props.active && model.playback.desiredPlaying)
          model.actions.visible(false)
        else reveal()
      } else model.actions.toggle()
    }
    const doubleClick = (event: MouseEvent) => {
      if (event.target === video) current().actions.fullscreen()
    }
    const keydown = (event: KeyboardEvent) => {
      const model = current(),
        target = event.target as HTMLElement
      if (event.key === 'Tab') {
        model.actions.focused(true)
        reveal()
        return
      }
      if (event.key === 'Escape' && model.settingsOpen) {
        model.actions.settings(false)
        event.preventDefault()
        return
      }
      if (
        target.closest('input, select, textarea, button') ||
        target.isContentEditable ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const position = model.props.active ? model.playback.position : 0
      switch (event.key.toLowerCase()) {
        case ' ':
        case 'k':
          model.actions.toggle()
          break
        case 'arrowleft':
          model.actions.seek(position - 5)
          break
        case 'arrowright':
          model.actions.seek(position + 5)
          break
        case 'j':
          model.actions.seek(position - 10)
          break
        case 'l':
          model.actions.seek(position + 10)
          break
        case 'f':
          model.actions.fullscreen()
          break
        case 'm':
          model.actions.mute()
          break
        default:
          return
      }
      event.preventDefault()
      reveal()
    }
    const metrics = () =>
      current().actions.metrics(
        document.fullscreenElement === container,
        container.clientWidth,
        container,
      )
    const fullscreenKeyboard = (event: KeyboardEvent) => {
      const model = current()
      if (event.key === 'Escape' && model.settingsOpen) {
        model.actions.settings(false)
        model.settingsAnchor?.focus()
        event.preventDefault()
      }
      if (document.fullscreenElement === container && event.key === 'Tab') {
        model.actions.focused(true)
        reveal()
      }
    }
    const resize = new ResizeObserver(metrics)
    resize.observe(container)
    metrics()
    container.addEventListener('pointermove', pointerMove)
    container.addEventListener('pointerdown', pointerDown)
    container.addEventListener('focusin', focusIn)
    container.addEventListener('focusout', focusOut)
    container.addEventListener('click', click)
    container.addEventListener('dblclick', doubleClick)
    container.addEventListener('keydown', keydown)
    document.addEventListener('fullscreenchange', metrics)
    document.addEventListener('keydown', fullscreenKeyboard)
    cleanup = () => {
      container.style.cursor = ''
      resize.disconnect()
      container.removeEventListener('pointermove', pointerMove)
      container.removeEventListener('pointerdown', pointerDown)
      container.removeEventListener('focusin', focusIn)
      container.removeEventListener('focusout', focusOut)
      container.removeEventListener('click', click)
      container.removeEventListener('dblclick', doubleClick)
      container.removeEventListener('keydown', keydown)
      document.removeEventListener('fullscreenchange', metrics)
      document.removeEventListener('keydown', fullscreenKeyboard)
    }
  }
  attach()
  return { update: attach, dispose: () => cleanup?.() }
}
export const VideoControls = controllerView({
  create: controlsController,
  view: view((model) => {
    const props = model.props
    const audio = () =>
      preferredTrack(
        model.info?.audio ?? [],
        model.preferences?.video.audioTrack,
        model.preferences?.global.audioLanguage,
        true,
      )
    const primary = () =>
      preferredTrack(
        model.info?.subtitles ?? [],
        model.preferences?.video.subtitleTrack,
        model.preferences?.global.subtitleLanguage,
      )
    const secondary = () => {
      const track = preferredTrack(
        model.info?.subtitles ?? [],
        model.preferences?.video.secondarySubtitleTrack,
        model.preferences?.global.secondarySubtitleLanguage,
      )
      return track?.id === primary()?.id ? undefined : track
    }
    const duration = () => (props.active ? model.playback.duration : 0) || model.info?.duration || 0
    const position = () => (props.active ? model.playback.position : 0)
    const playing = () => props.active && model.playback.desiredPlaying
    const error = () => (props.active ? model.playback.error : null)
    const loading = () =>
      props.active && (model.playback.phase === 'resolving' || model.playback.buffering)
    const visible = () => model.visible,
      settingsOpen = () => model.settingsOpen,
      settingsAnchor = () => model.settingsAnchor,
      fullscreen = () => model.fullscreen,
      width = () => model.width
    const setSettingsOpen = (open: boolean) => model.actions.settings(open)
    const chooseTrack = model.actions.track,
      toggle = model.actions.toggle,
      toggleFullscreen = model.actions.fullscreen
    const buttonClass =
      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'
    return (
      <>
        <span class='hidden' use={domBinding(model, controlsBehavior)} />
        <div
          class='pointer-events-none absolute inset-x-3 z-10 flex flex-col items-center gap-1 text-center font-medium text-white'
          style={{
            bottom: visible() ? '5.75rem' : '1.25rem',
            'font-size': 'clamp(16px, 2.2vw, 28px)',
            'text-shadow': '0 1px 3px black, 0 0 4px black',
          }}
          data-testid='video-subtitles'
        >
          {secondary() ? (
            <VideoSubtitleLine
              path={props.path}
              track={secondary()!}
              fingerprint={model.info?.fingerprint}
              position={position()}
              secondary
            />
          ) : null}
          {primary() ? (
            <VideoSubtitleLine
              path={props.path}
              track={primary()!}
              fingerprint={model.info?.fingerprint}
              position={position()}
            />
          ) : null}
        </div>
        {loading() && !error() ? (
          <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center'>
            <LoaderCircle class='h-8 w-8 animate-spin text-white' />
          </div>
        ) : null}
        {error() ? (
          <div
            class='absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-5 text-center text-white'
            role='alert'
          >
            <p class='max-w-lg text-sm'>{error()}</p>
            <div class='flex gap-3'>
              <button
                type='button'
                class='rounded-md bg-white px-3 py-2 text-sm text-black'
                onClick={() => model.actions.retry()}
              >
                Retry
              </button>
              <a
                class='rounded-md border border-white/40 px-3 py-2 text-sm'
                href={fileDownloadHref(props.path)}
                download
              >
                Download
              </a>
            </div>
          </div>
        ) : null}
        <div
          class={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-150 ${visible() ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          data-testid='video-controls'
          aria-hidden={visible() ? 'false' : 'true'}
        >
          <FloatingContextMenu
            open={settingsOpen()}
            anchorRef={settingsAnchor()}
            onDismiss={() => setSettingsOpen(false)}
            mount={fullscreen() ? model.container : undefined}
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
                      props.active
                        ? model.playback.playbackRate
                        : (model.preferences?.video.speed ?? 1),
                    )}
                    mount={fullscreen() ? model.container : undefined}
                    options={Array.from({ length: 12 }, (_, index) => {
                      const rate = (index + 1) / 4
                      return {
                        value: String(rate),
                        label: `${rate}×${rate === 1 ? ' · Normal' : ''}`,
                      }
                    })}
                    onChange={(value) => {
                      model.actions.speed(Number(value))
                    }}
                  />
                </label>
                <label class='block space-y-1 text-xs'>
                  <span>Audio</span>
                  <PlaybackSetting
                    label='Audio track'
                    value={audio()?.id ?? ''}
                    mount={fullscreen() ? model.container : undefined}
                    options={
                      model.info?.audio.length
                        ? model.info!.audio.map((track) => ({
                            value: track.id,
                            label: trackLabel(track),
                          }))
                        : [{ value: '', label: 'No audio tracks' }]
                    }
                    disabled={!model.info?.audio.length || model.saved.waiting}
                    onChange={(value) => chooseTrack('audioTrack', value)}
                  />
                </label>
                {(['subtitleTrack', 'secondarySubtitleTrack'] as const).map((kind) => (
                  <label class='block space-y-1 text-xs'>
                    <span>{kind === 'subtitleTrack' ? 'Subtitles' : 'Second subtitles'}</span>
                    <PlaybackSetting
                      label={kind === 'subtitleTrack' ? 'Subtitles' : 'Second subtitles'}
                      value={(kind === 'subtitleTrack' ? primary() : secondary())?.id ?? ''}
                      mount={fullscreen() ? model.container : undefined}
                      options={[
                        { value: '', label: 'Off' },
                        ...(model.info?.subtitles ?? []).map((track) => ({
                          value: track.id,
                          label: trackLabel(track),
                          disabled: !track.supported,
                        })),
                      ]}
                      disabled={model.saved.waiting}
                      onChange={(value) => chooseTrack(kind, value)}
                    />
                  </label>
                ))}
                {model.infoError ? (
                  <p class='text-destructive text-xs'>
                    Track information is unavailable. FFmpeg and ffprobe are required on the server.
                  </p>
                ) : null}
                {resourceError(model.saved) || model.uiError ? (
                  <p class='text-destructive text-xs' role='alert'>
                    {resourceError(model.saved) || model.uiError}
                  </p>
                ) : null}
              </div>
            </div>
          </FloatingContextMenu>
          <div class='border-border bg-background text-foreground border-t px-2 py-1.5'>
            <PlaybackScrubber
              itemKey={props.path}
              ariaLabel='Seek video'
              ariaValueText={(value) => `${timeLabel(value)} of ${timeLabel(duration())}`}
              class='video-slider block w-full'
              style={{ '--video-progress': `${duration() ? (position() / duration()) * 100 : 0}%` }}
              duration={duration() || 1}
              position={position()}
              onSeek={model.actions.seek}
              onActivity={model.actions.reveal}
              onDraggingChange={model.actions.scrubbing}
            />
            <div class='flex flex-wrap items-center gap-1'>
              <button
                type='button'
                class={cn(buttonClass, 'bg-primary text-primary-foreground hover:bg-primary/90')}
                aria-label={playing() ? 'Pause video' : 'Play video'}
                onClick={toggle}
              >
                {playing() ? <Pause class='h-4 w-4' /> : <Play class='h-4 w-4' />}
              </button>
              <button
                type='button'
                class={buttonClass}
                aria-label={model.playback.muted ? 'Unmute video' : 'Mute video'}
                onClick={() => model.actions.mute()}
              >
                {!model.playback.muted ? <Volume2 class='h-4 w-4' /> : <VolumeX class='h-4 w-4' />}
              </button>
              {width() >= 480 ? (
                <input
                  type='range'
                  aria-label='Video volume'
                  class='video-slider w-20'
                  style={{
                    '--video-progress': `${model.playback.muted ? 0 : model.playback.volume * 100}%`,
                  }}
                  min='0'
                  max='1'
                  step='0.01'
                  value={model.playback.muted ? 0 : model.playback.volume}
                  onInput={(event) => model.actions.volume(Number(event.currentTarget.value))}
                />
              ) : null}
              <span class='ml-1 whitespace-nowrap text-xs tabular-nums'>
                {timeLabel(position())} / {timeLabel(duration())}
              </span>
              <div class='flex-1' />
              {props.onListenOnly ? (
                <button
                  type='button'
                  class={buttonClass}
                  aria-label='Listen only'
                  title='Listen only'
                  onClick={() => props.onListenOnly?.()}
                >
                  <Headphones class='h-4 w-4' />
                </button>
              ) : null}
              {model.playback.playbackRate !== 1 ? (
                <span class='text-muted-foreground text-xs'>{model.playback.playbackRate}×</span>
              ) : null}
              <button
                type='button'
                class={buttonClass}
                aria-label='Playback settings'
                aria-expanded={settingsOpen() ? 'true' : 'false'}
                onClick={(event) =>
                  model.actions.settings(!model.settingsOpen, event.currentTarget)
                }
              >
                <Settings2 class='h-4 w-4' />
              </button>
              <button
                type='button'
                class={buttonClass}
                aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={toggleFullscreen}
              >
                {fullscreen() ? <Minimize class='h-4 w-4' /> : <Maximize class='h-4 w-4' />}
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }),
})
type SubtitleProps = {
  path: string
  track: VideoTrack
  fingerprint?: string
  position: number
  secondary?: boolean
}
const subtitlesQuery = query({
  name: 'video-subtitles',
  groups: [groups.playback],
  staleTime: Infinity,
  load: (args: { path: string; fingerprint?: string; track: string }) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(
            `/api/playback/subtitle?${new URLSearchParams({ path: args.path, track: args.track })}`,
            { signal },
          ),
        catch: (error) => error,
      })
      if (!response.ok) {
        const body = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () => null,
        }).pipe(Effect.catch(() => Effect.succeed(null)))
        const error = Option.getOrUndefined(Schema.decodeUnknownOption(playbackStatusSchema)(body))
        return yield* Effect.fail(new Error(error?.error ?? 'Subtitles could not be loaded'))
      }
      const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (error) => error })
      return parseSubtitles(text)
    }),
})
const VideoSubtitleLine = controllerView({
  create: (props: Snapshot<SubtitleProps>) => {
    const owner = modelOwner({ props, cues: [] as ReturnType<typeof parseSubtitles>, error: '' })
    const resource = observeQuery(owner, queryCache, subtitlesQuery, (result) =>
      owner.patch({ cues: available(result) ?? [], error: resourceError(result) }),
    )
    const select = (next: Snapshot<SubtitleProps>) =>
      resource.select({ path: next.path, fingerprint: next.fingerprint, track: next.track.id })
    select(props)
    return {
      source: owner.source,
      receive: (next: Snapshot<SubtitleProps>) => {
        owner.patch({ props: next })
        select(next)
      },
      dispose: owner.dispose,
    }
  },
  view: view((model) => {
    const text = subtitleText([...model.cues], model.props.position)
    return (
      <>
        {text ? (
          <div
            class={cn(
              'max-w-[92%] whitespace-pre-line rounded bg-black/60 px-2 py-0.5',
              model.props.secondary && 'text-[0.85em]',
            )}
            data-testid={
              model.props.secondary ? 'video-subtitle-secondary' : 'video-subtitle-primary'
            }
          >
            {text}
          </div>
        ) : null}
        {model.error ? (
          <p class='rounded bg-black/80 px-2 text-sm text-white' role='alert'>
            {model.error}
          </p>
        ) : null}
      </>
    )
  }),
})
