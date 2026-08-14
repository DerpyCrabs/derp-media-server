import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { navigateSearchParams } from '@/src/browser-history'
import { usePlaybackMediaHost, usePlaybackSession, usePlaybackSnapshot } from './PlaybackProvider'

const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
] as const

export function PlaybackMediaHost() {
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()
  const mediaHost = usePlaybackMediaHost()
  const [audioElement, setAudioElement] = createSignal<HTMLAudioElement>()
  const handlesAudio = createMemo(() => {
    const state = snapshot()
    return !!state.currentItem && state.mode === 'audio'
  })

  onMount(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', () => session.dispatch({ type: 'play' }))
    navigator.mediaSession.setActionHandler('pause', () => session.dispatch({ type: 'pause' }))
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const state = session.getSnapshot()
      session.dispatch({
        type: 'seek',
        position: Math.max(0, state.position - (details.seekOffset || 10)),
      })
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const state = session.getSnapshot()
      session.dispatch({
        type: 'seek',
        position: Math.min(
          state.duration || Number.POSITIVE_INFINITY,
          state.position + (details.seekOffset || 10),
        ),
      })
    })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) {
        session.dispatch({ type: 'seek', position: details.seekTime })
      }
    })
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      session.dispatch({ type: 'previous' }),
    )
    navigator.mediaSession.setActionHandler('nexttrack', () => session.dispatch({ type: 'next' }))

    onCleanup(() => {
      navigator.mediaSession.metadata = null
      try {
        navigator.mediaSession.playbackState = 'none'
      } catch {}
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {}
      }
    })
  })

  createEffect(() => {
    const element = audioElement()
    if (!element || !handlesAudio()) return
    const detach = mediaHost.attach(element, 'audio')
    onCleanup(detach)
  })

  createEffect(() => {
    if (!('mediaSession' in navigator)) return
    const state = snapshot()
    navigator.mediaSession.playbackState =
      state.phase === 'playing' ? 'playing' : state.currentItem ? 'paused' : 'none'
    const item = state.currentItem
    navigator.mediaSession.metadata = item ? new MediaMetadata({ title: item.name }) : null
  })

  let observedItem = ''
  createEffect(() => {
    const state = snapshot()
    const item = state.currentItem
    if (!item || typeof window === 'undefined' || window.location.pathname !== '/') return
    const signature = `${item.resource.provider}\0${item.resource.id}\0${state.mode}`
    if (signature === observedItem) return
    observedItem = signature
    const params = new URLSearchParams(window.location.search)
    if (!params.has('playing')) return
    const audioOnly = item.media === 'video' && state.mode === 'audio'
    if (
      params.get('playing') !== item.locator ||
      (params.get('audioOnly') === 'true') !== audioOnly
    ) {
      navigateSearchParams(
        { playing: item.locator, audioOnly: audioOnly ? 'true' : null },
        'replace',
      )
    }
  })

  return (
    <audio
      ref={setAudioElement}
      preload='auto'
      class='hidden'
      data-playback-media-host='audio'
      data-playback-audio-host
      data-workspace-taskbar-media-audio
    />
  )
}
