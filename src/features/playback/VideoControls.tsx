import { VideoNavigationDialog } from './VideoNavigationDialog'
import { chapterAt, precisePlaybackTime } from './video-navigation'
import type { PlaybackLoop } from './types'
import { decodeSubtitleFile, MAX_SUBTITLE_BYTES } from './local-subtitles'
import { randomId } from '@/lib/random-id'
import { list, Portal } from 'effectweb'
import { VideoSnapshotDialog, type VideoSnapshotRequest } from './VideoSnapshotDialog'
import { playbackStatusSchema } from './playback-schemas'
import { Schema, Option } from 'effect'
import { videoPreferencesSchema } from './playback-schemas'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import {
  available,
  domBinding,
  modelOwner,
  resourceError,
  view,
  controllerView,
  type ControllerModel,
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
import { parseSubtitles, subtitleText, type SubtitleCue } from './subtitles'
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
    track.id.startsWith('local:') ? 'Local file' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
type SubtitleKind = 'subtitleTrack' | 'secondarySubtitleTrack'
type LocalSubtitle = VideoTrack & { cues: SubtitleCue[] }
const hideSlot = 'video-controls-hide'
const fullscreenSlot = 'video-fullscreen'
function controlsController(props: Props) {
  const session = getPlaybackSession()
  let subtitleInput: HTMLInputElement | undefined
  let importKind: SubtitleKind = 'subtitleTrack'
  let previousPath = '',
    previousAudio: string | undefined,
    hideKey = ''
  const owner = modelOwner({
    props,
    playback: playbackSource.model(),
    visible: true,
    settingsOpen: false,
    navigationOpen: false,
    fullscreen: false,
    focused: false,
    scrubbing: false,
    uiError: '',
    snapshot: null as VideoSnapshotRequest | null,
    localSubtitles: [] as LocalSubtitle[],
    localSelection: {} as Partial<Record<SubtitleKind, string>>,
    subtitleLoading: false,
    subtitleError: '',
    settingsAnchor: null as HTMLButtonElement | null,
    width: 0,
    container: undefined as HTMLElement | undefined,
    info: undefined as VideoInfo | undefined,
    preferences: undefined as VideoPreferences | undefined,
    infoError: false,
    saved: AsyncResult.initial<unknown, unknown>(),
  })
  const save = (video: VideoPreferences['video'], global?: VideoPreferences['global']) => {
    const path = owner.read().props.path
    return owner.task(
      'saved',
      postSchemaEffect(videoPreferencesSchema, '/api/playback/preferences', {
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
      ),
      'queue',
    )
  }
  const actions = {
    clearError: () => owner.patch({ uiError: '' }),
    navigation: (navigationOpen: boolean) => {
      owner.patch({ navigationOpen, settingsOpen: false })
      syncHide()
    },
    loop: (loop: PlaybackLoop | null) => {
      const current = owner.read()
      if (!current.props.active) actions.seek(loop?.start ?? 0)
      const result = session.dispatch({ type: 'setLoop', loop })
      owner.patch({
        uiError: result.accepted
          ? ''
          : 'The repeat needs two points at least 0.25 seconds apart within the video.',
      })
      reveal()
    },
    cycleLoop: () => {
      const current = owner.read(),
        loop = current.props.active ? current.playback.loop : null,
        position = current.props.active ? current.playback.position : 0
      if (!loop) actions.loop({ start: position, end: null })
      else if (loop.end !== null) actions.loop(null)
      else
        actions.loop({ start: Math.min(loop.start, position), end: Math.max(loop.start, position) })
    },
    chapter: (direction: -1 | 1) => {
      const current = owner.read(),
        chapters = current.info?.chapters ?? [],
        position = current.props.active ? current.playback.position : 0
      const index = chapterAt(chapters, position)
      const target =
        direction === -1 && index >= 0 && position - chapters[index]!.start > 3
          ? index
          : index + direction
      const chapter = chapters[Math.max(0, Math.min(chapters.length - 1, target))]
      if (chapter) actions.seek(chapter.start)
    },
    snapshot: () => {
      const current = owner.read()
      if (!current.props.active || !current.props.video || current.snapshot) return
      owner.patch({
        snapshot: {
          path: current.props.path,
          position: current.playback.position,
          video: current.props.video,
        },
        settingsOpen: false,
      })
    },
    closeSnapshot: () => owner.patch({ snapshot: null, navigationOpen: false }),
    attachSubtitleInput: (input: HTMLInputElement | undefined) => {
      subtitleInput = input
    },
    openSubtitle: (kind: SubtitleKind) => {
      importKind = kind
      if (subtitleInput) {
        subtitleInput.value = ''
        subtitleInput.click()
      }
    },
    importSubtitle: (file: File | undefined) => {
      if (!file) return
      const kind = importKind,
        path = owner.read().props.path
      owner.patch({ subtitleLoading: true, subtitleError: '' })
      owner.run(
        'local-subtitle',
        Effect.gen(function* () {
          if (file.size > MAX_SUBTITLE_BYTES)
            return yield* Effect.fail(new Error('Subtitle files must be smaller than 4 MiB.'))
          const bytes = yield* Effect.tryPromise(() => file.arrayBuffer())
          const cues = yield* Effect.try({
            try: () => decodeSubtitleFile(new Uint8Array(bytes), file.name),
            catch: (error) => error,
          })
          if (owner.read().props.path !== path) return undefined
          const state = owner.read(),
            existing = state.localSubtitles.find((track) => track.title === file.name)
          const track: LocalSubtitle = {
            id: existing?.id ?? `local:${randomId()}`,
            index: null,
            codec: file.name.split('.').at(-1)!.toLowerCase(),
            language: 'und',
            title: file.name,
            supported: true,
            default: false,
            cues,
          }
          const tracks = state.localSubtitles.filter((item) => item.id !== track.id)
          if (tracks.length >= 8)
            return yield* Effect.fail(
              new Error(
                'Up to eight local subtitle files can be open for one video. Close and reopen the video to start over.',
              ),
            )
          owner.patch({
            localSubtitles: [...tracks, track],
            localSelection: { ...state.localSelection, [kind]: track.id },
            subtitleLoading: false,
          })
          return undefined
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              owner.patch({
                subtitleLoading: false,
                subtitleError:
                  error instanceof Error ? error.message : 'Could not read the subtitle file.',
              }),
            ),
          ),
        ),
        'replace',
      )
    },
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
    subtitleDelay: (delay: number) => {
      if (Number.isFinite(delay)) void save({ subtitleDelay: Math.max(-600, Math.min(600, delay)) })
    },
    speed: (speed: number) => {
      if (owner.read().props.active) session.dispatch({ type: 'setPlaybackRate', rate: speed })
      void save({ speed })
    },
    track: (kind: 'audioTrack' | 'subtitleTrack' | 'secondarySubtitleTrack', value: string) => {
      if (kind !== 'audioTrack') {
        const selected = owner.read().localSubtitles.find((track) => track.id === value)
        const localSelection = { ...owner.read().localSelection }
        if (selected) {
          owner.patch({ localSelection: { ...localSelection, [kind]: value }, subtitleError: '' })
          return
        }
        delete localSelection[kind]
        owner.patch({ localSelection, subtitleError: '' })
      }
      const current = owner.read(),
        tracks = kind === 'audioTrack' ? current.info?.audio : current.info?.subtitles
      const selected = tracks?.find((track) => track.id === value)
      const languageKey =
        kind === 'audioTrack'
          ? 'audioLanguage'
          : kind === 'subtitleTrack'
            ? 'subtitleLanguage'
            : 'secondarySubtitleLanguage'
      void save(
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
      !current.navigationOpen &&
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
    const key = `${current.props.active && current.playback.desiredPlaying}:${current.settingsOpen}:${current.navigationOpen}:${current.focused}:${current.scrubbing}`
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
    ...actions,
    receive: (next: Props) => {
      if (next.path !== owner.read().props.path) {
        owner.cancel('local-subtitle')
        owner.patch({ snapshot: null })
        owner.patch({
          localSubtitles: [],
          localSelection: {},
          subtitleError: '',
          subtitleLoading: false,
        })
      }
      owner.patch({ props: next })
      info.select(next.path || undefined)
      preferences.select(next.path || undefined)
      syncPreferences()
      syncHide()
    },
    lifetime: owner,
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
      if (event.target === video) void current().actions.fullscreen()
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
      if (event.shiftKey && event.key.toLowerCase() === 'l') {
        model.actions.cycleLoop()
        event.preventDefault()
        return
      }
      if (event.shiftKey && event.key.toLowerCase() === 's') {
        model.actions.snapshot()
        event.preventDefault()
        return
      }
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
        case 'g':
          model.actions.navigation(true)
          break
        case 'pageup':
          model.actions.chapter(-1)
          break
        case 'pagedown':
          model.actions.chapter(1)
          break
        case 'f':
          void model.actions.fullscreen()
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
const subtitleInputBinding = (
  element: HTMLInputElement,
  current: () => (input: HTMLInputElement | undefined) => void,
) => {
  current()(element)
  return { update: () => undefined, dispose: () => current()(undefined) }
}
export const VideoControls = controllerView(
  { controller: controlsController },
  view((model) => {
    const props = model.props
    const audio = () =>
      preferredTrack(
        model.info?.audio ?? [],
        model.preferences?.video.audioTrack,
        model.preferences?.global.audioLanguage,
        true,
      )
    const local = (kind: SubtitleKind) =>
      model.localSubtitles.find((track) => track.id === model.localSelection[kind])
    const primary = () =>
      local('subtitleTrack') ??
      preferredTrack(
        model.info?.subtitles ?? [],
        model.preferences?.video.subtitleTrack,
        model.preferences?.global.subtitleLanguage,
      )
    const secondary = () => {
      const track =
        local('secondarySubtitleTrack') ??
        preferredTrack(
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
    const visible = model.visible,
      settingsOpen = model.settingsOpen,
      settingsAnchor = model.settingsAnchor,
      fullscreen = model.fullscreen,
      width = model.width
    const setSettingsOpen = (open: boolean) => model.actions.settings(open)
    const chooseTrack = model.actions.track,
      toggle = model.actions.toggle,
      toggleFullscreen = model.actions.fullscreen
    const buttonClass =
      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'
    return (
      <>
        <span class='hidden' use={domBinding(model, controlsBehavior)} />
        {model.snapshot ? (
          <Portal mount={fullscreen ? model.container : undefined}>
            <VideoSnapshotDialog request={model.snapshot} onClose={model.actions.closeSnapshot} />
          </Portal>
        ) : null}
        {model.navigationOpen ? (
          <Portal mount={fullscreen ? model.container : undefined}>
            <VideoNavigationDialog
              position={position()}
              duration={duration()}
              chapters={model.info?.chapters ?? []}
              loop={props.active ? model.playback.loop : null}
              onSeek={model.actions.seek}
              onLoop={model.actions.loop}
              onClose={() => model.actions.navigation(false)}
            />
          </Portal>
        ) : null}
        <input
          type='file'
          class='hidden'
          aria-label='Open subtitle file'
          accept='.srt,.vtt'
          use={domBinding(model.actions.attachSubtitleInput, subtitleInputBinding)}
          onChange={(event) => model.actions.importSubtitle(event.currentTarget.files?.[0])}
        />
        <div
          class='pointer-events-none absolute inset-x-3 z-10 flex flex-col items-center gap-1 text-center font-medium text-white'
          style={{
            bottom: visible ? '5.75rem' : '1.25rem',
            'font-size': 'clamp(16px, 2.2vw, 28px)',
            'text-shadow': '0 1px 3px black, 0 0 4px black',
          }}
          data-testid='video-subtitles'
        >
          {secondary() ? (
            <VideoSubtitleLine
              path={props.path}
              track={secondary()!}
              localCues={local('secondarySubtitleTrack')?.cues}
              fingerprint={model.info?.fingerprint}
              position={position() - (model.preferences?.video.subtitleDelay ?? 0)}
              secondary
            />
          ) : null}
          {primary() ? (
            <VideoSubtitleLine
              path={props.path}
              track={primary()!}
              localCues={local('subtitleTrack')?.cues}
              fingerprint={model.info?.fingerprint}
              position={position() - (model.preferences?.video.subtitleDelay ?? 0)}
            />
          ) : null}
        </div>
        {model.uiError && !settingsOpen ? (
          <div
            role='alert'
            class='absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-2 rounded bg-black/80 p-2 text-sm text-white'
          >
            <span>{model.uiError}</span>
            <button
              class='shrink-0 rounded px-2 py-1 hover:bg-white/20'
              onClick={() => model.actions.clearError()}
            >
              Dismiss
            </button>
          </div>
        ) : null}
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
          class={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-150 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          data-testid='video-controls'
          aria-hidden={visible ? 'false' : 'true'}
        >
          <FloatingContextMenu
            open={settingsOpen}
            anchorRef={settingsAnchor}
            onDismiss={() => setSettingsOpen(false)}
            mount={fullscreen ? model.container : undefined}
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
                <button
                  class='flex min-h-9 w-full items-center justify-between rounded px-2 text-left text-sm hover:bg-accent'
                  onClick={() => model.actions.navigation(true)}
                >
                  Navigate / repeat…<span class='text-xs text-muted-foreground'>G</span>
                </button>
                <button
                  class='flex min-h-9 w-full items-center justify-between rounded px-2 text-left text-sm hover:bg-accent disabled:opacity-40'
                  disabled={!props.active || !props.video?.videoWidth}
                  onClick={model.actions.snapshot}
                >
                  Save video frame…<span class='text-xs text-muted-foreground'>Shift+S</span>
                </button>
                <label class='block space-y-1 text-xs'>
                  <span>Speed</span>
                  <PlaybackSetting
                    label='Playback speed'
                    value={String(
                      props.active
                        ? model.playback.playbackRate
                        : (model.preferences?.video.speed ?? 1),
                    )}
                    mount={fullscreen ? model.container : undefined}
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
                    mount={fullscreen ? model.container : undefined}
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
                {list(['subtitleTrack', 'secondarySubtitleTrack'] as const, (kind) => (
                  <label class='block space-y-1 text-xs'>
                    <span>{kind === 'subtitleTrack' ? 'Subtitles' : 'Second subtitles'}</span>
                    <PlaybackSetting
                      label={kind === 'subtitleTrack' ? 'Subtitles' : 'Second subtitles'}
                      value={(kind === 'subtitleTrack' ? primary() : secondary())?.id ?? ''}
                      mount={fullscreen ? model.container : undefined}
                      options={[
                        { value: '', label: 'Off' },
                        ...[...(model.info?.subtitles ?? []), ...model.localSubtitles].map(
                          (track) => ({
                            value: track.id,
                            label: trackLabel(track),
                            disabled: !track.supported,
                          }),
                        ),
                      ]}
                      disabled={model.saved.waiting || model.subtitleLoading}
                      action={{
                        label: 'Open subtitle file…',
                        onClick: () => model.actions.openSubtitle(kind),
                      }}
                      onChange={(value) => chooseTrack(kind, value)}
                    />
                  </label>
                ))}
                {model.subtitleError ? (
                  <p role='alert' class='text-xs text-destructive'>
                    {model.subtitleError}
                  </p>
                ) : null}
                {model.subtitleLoading ? (
                  <p role='status' class='text-xs text-muted-foreground'>
                    Opening subtitles…
                  </p>
                ) : null}
                {primary() || secondary() ? (
                  <label class='block space-y-1 text-xs'>
                    <span>Subtitle delay (seconds)</span>
                    <input
                      type='number'
                      aria-label='Subtitle delay (seconds)'
                      min={-600}
                      max={600}
                      step={0.1}
                      value={model.preferences?.video.subtitleDelay ?? 0}
                      class='w-full rounded border border-input bg-background px-2 py-1.5'
                      onChange={(event) => {
                        if (event.currentTarget.value.trim())
                          model.actions.subtitleDelay(Number(event.currentTarget.value))
                      }}
                    />
                    <span class='block text-muted-foreground'>
                      Positive values show subtitles later. Set 0 to reset.
                    </span>
                  </label>
                ) : null}
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
              {width >= 480 ? (
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
              <button
                class='ml-1 whitespace-nowrap rounded px-1 py-1 text-xs tabular-nums hover:bg-accent'
                aria-label='Go to time'
                title='Go to time / chapters (G)'
                onClick={() => model.actions.navigation(true)}
              >
                {timeLabel(position())} / {timeLabel(duration())}
              </button>
              {props.active && model.playback.loop ? (
                <button
                  class='rounded bg-primary/15 px-1.5 py-1 text-xs text-primary'
                  aria-label='Clear section repeat'
                  title={`A ${precisePlaybackTime(model.playback.loop.start)}${model.playback.loop.end === null ? ' · Set B with Shift+L' : ` – B ${precisePlaybackTime(model.playback.loop.end)}`}`}
                  onClick={() => model.actions.loop(null)}
                >
                  {model.playback.loop.end === null ? 'A…' : 'A–B'} ×
                </button>
              ) : null}
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
                aria-expanded={settingsOpen ? 'true' : 'false'}
                onClick={(event) =>
                  model.actions.settings(!model.settingsOpen, event.currentTarget)
                }
              >
                <Settings2 class='h-4 w-4' />
              </button>
              <button
                type='button'
                class={buttonClass}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Minimize class='h-4 w-4' /> : <Maximize class='h-4 w-4' />}
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }),
)
type SubtitleProps = {
  path: string
  track: VideoTrack
  localCues?: readonly SubtitleCue[]
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
const VideoSubtitleLine = controllerView(
  {
    controller: (props: SubtitleProps) => {
      const owner = modelOwner({ props, cues: [] as readonly SubtitleCue[], error: '' })
      const resource = observeQuery(owner, queryCache, subtitlesQuery, (result) =>
        owner.patch({ cues: available(result) ?? [], error: resourceError(result) }),
      )
      const select = (next: SubtitleProps) => {
        resource.select(
          next.localCues
            ? undefined
            : { path: next.path, fingerprint: next.fingerprint, track: next.track.id },
        )
        if (next.localCues) owner.patch({ cues: next.localCues, error: '' })
      }
      select(props)
      return {
        source: owner.source,
        receive: (next: SubtitleProps) => {
          owner.patch({ props: next })
          select(next)
        },
        lifetime: owner,
      }
    },
  },
  view((model) => {
    const text = subtitleText(model.cues, model.props.position)
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
)
