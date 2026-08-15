import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'
import { createEffect, createMemo, createSignal, onSettled } from 'solid-js'
import { queryKeys } from '@/lib/api/query-keys'
import { MediaType, type FileItem } from '@/lib/files/types'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import { parentPath } from '@/lib/files/path-utils'
import {
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
} from '@/lib/media/build-media-url'
import { fetchAudioMetadata } from './audio'
import { buildPlaybackMediaSessionMetadata } from './media-session-metadata'
import { setPlaybackMediaSessionPosition } from './media-session-position'
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
  const playingPath = createMemo(() => snapshot().currentItem?.locator ?? '')
  const currentDir = createMemo(() => parentPath(playingPath()))

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(currentDir()),
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentDir())}`),
    enabled: handlesAudio() && !!playingPath(),
  }))
  const allFiles = createMemo(() => filesQuery.data?.files ?? [])
  const folderCoverUrl = createMemo(() => {
    const cover = allFiles().find(
      (file) =>
        file.type === MediaType.IMAGE &&
        file.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover',
    )
    return cover ? buildMediaUrl(cover.path) : null
  })
  const metadataUrl = createMemo(() => {
    const path = playingPath()
    return path ? buildAudioMetadataUrl(path) : ''
  })
  const metadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(playingPath()),
    queryFn: () => fetchAudioMetadata(metadataUrl()),
    enabled: handlesAudio() && !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))
  const audioMetadata = createMemo(() => metadataQuery.data)
  const artworkUrl = createMemo(() => {
    const item = snapshot().currentItem
    const path = item?.locator
    if (!item || !path) return null
    if (item.media === 'video') return buildThumbnailUrl(path)
    return audioMetadata()?.coverArt || folderCoverUrl()
  })

  onSettled(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined
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
      if (details.seekTime != null) session.dispatch({ type: 'seek', position: details.seekTime })
    })
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      session.dispatch({ type: 'previous' }),
    )
    navigator.mediaSession.setActionHandler('nexttrack', () => session.dispatch({ type: 'next' }))

    return () => {
      navigator.mediaSession.metadata = null
      try {
        navigator.mediaSession.playbackState = 'none'
      } catch {}
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {}
      }
    }
  })

  createEffect(
    () => {
      const element = audioElement()
      return element && handlesAudio() ? element : null
    },
    (element) => {
      if (!element) return undefined
      const detach = mediaHost.attach(element, 'audio')
      // eslint-disable-next-line solid/reactivity
      return detach
    },
  )

  createEffect(
    () => {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null
      const state = snapshot()
      return {
        state,
        album: currentDir(),
        metadata: handlesAudio() ? audioMetadata() : undefined,
        artworkUrl: artworkUrl(),
      }
    },
    (next) => {
      if (!next) return
      const { state } = next
      navigator.mediaSession.playbackState =
        state.phase === 'playing' ? 'playing' : state.currentItem ? 'paused' : 'none'
      const item = state.currentItem
      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = item
          ? new MediaMetadata(
              buildPlaybackMediaSessionMetadata({
                item,
                mode: state.mode,
                album: next.album,
                metadata: next.metadata,
                artworkUrl: next.artworkUrl,
                artworkBaseUrl: typeof window === 'undefined' ? undefined : window.location.origin,
              }),
            )
          : null
      }
    },
  )

  createEffect(
    () => {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null
      const element = audioElement()
      const state = snapshot()
      return element && handlesAudio() ? { element, state } : null
    },
    (next) => {
      if (!next) return
      const duration = Number.isFinite(next.element.duration)
        ? next.element.duration
        : next.state.duration
      const position = Number.isFinite(next.element.currentTime)
        ? next.element.currentTime
        : next.state.position
      setPlaybackMediaSessionPosition(navigator.mediaSession, {
        duration,
        position,
        playbackRate: next.element.playbackRate,
      })
    },
  )

  let observedItem = ''
  createEffect(
    () => {
      const state = snapshot()
      const item = state.currentItem
      if (!item || typeof window === 'undefined' || window.location.pathname !== '/') return null
      return { state, item, signature: `${item.locator}\0${state.mode}` }
    },
    (next) => {
      if (!next || next.signature === observedItem) return
      observedItem = next.signature
      const params = new URLSearchParams(window.location.search)
      if (!params.has('playing')) return
      const audioOnly = next.item.media === 'video' && next.state.mode === 'audio'
      if (
        params.get('playing') !== next.item.locator ||
        (params.get('audioOnly') === 'true') !== audioOnly
      ) {
        navigateSearchParams(
          { playing: next.item.locator, audioOnly: audioOnly ? 'true' : null },
          'replace',
        )
      }
    },
  )

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
