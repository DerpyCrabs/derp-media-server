import { directoryFilesSchema } from '@/lib/files/file-schemas'
import { audioMetadataSchema } from './playback-schemas'
import { available, domMount, modelOwner, observe, view } from 'effectweb'
import { queryCache, groups, seedQuery } from '@/lib/api/cache'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import { MediaType } from '@/lib/files/types'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import { parentPath } from '@/lib/files/path-utils'
import {
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
} from '@/lib/media/build-media-url'
import { fetchAudioMetadataEffect } from './audio'
import { buildPlaybackMediaSessionMetadata } from './media-session-metadata'
import { setPlaybackMediaSessionPosition } from './media-session-position'
import { getPlaybackMediaHost, getPlaybackSession, playbackSource } from './PlaybackProvider'
import { observeQuery, query } from '@effectweb/query'

export const playbackFilesQuery = query({
  name: 'playback-files',
  groups: [groups.files],
  staleTime: Infinity,
  load: (path: string) => fetchDirectoryFilesEffect(path),
})
export const audioMetadataQuery = query({
  name: 'audio-metadata',
  groups: [groups.playback],
  staleTime: Infinity,
  load: (path: string) => fetchAudioMetadataEffect(buildAudioMetadataUrl(path)),
})
const actions = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
] as const
const audioHost = domMount((element: HTMLAudioElement) => {
  const session = getPlaybackSession()
  const host = getPlaybackMediaHost()
  const owner = modelOwner({})
  let detached: (() => void) | undefined
  let selectedPath = ''
  let observedItem = ''
  let metadata: typeof audioMetadataSchema.Type | undefined
  let files: (typeof directoryFilesSchema.Type)['files'] = []
  const updateMetadata = () => {
    if (!('mediaSession' in navigator)) return
    const state = session.getSnapshot()
    const item = state.currentItem
    const path = item?.locator ?? ''
    const cover = files.find(
      (file) =>
        file.type === MediaType.IMAGE &&
        file.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover',
    )
    const artwork =
      item?.media === 'video'
        ? buildThumbnailUrl(path)
        : metadata?.coverArt || (cover ? buildMediaUrl(cover.path) : null)
    navigator.mediaSession.playbackState =
      state.phase === 'playing' ? 'playing' : item ? 'paused' : 'none'
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = item
        ? new MediaMetadata(
            buildPlaybackMediaSessionMetadata({
              item,
              mode: state.mode,
              album: parentPath(path),
              metadata: state.mode === 'audio' ? metadata : undefined,
              artworkUrl: artwork,
              artworkBaseUrl: window.location.origin,
            }),
          )
        : null
    }
    if (state.mode === 'audio')
      setPlaybackMediaSessionPosition(navigator.mediaSession, {
        duration: Number.isFinite(element.duration) ? element.duration : state.duration,
        position: Number.isFinite(element.currentTime) ? element.currentTime : state.position,
        playbackRate: element.playbackRate,
      })
  }
  const directory = observeQuery(owner, queryCache, playbackFilesQuery, (result) => {
    files = [...(available(result)?.files ?? [])]
    updateMetadata()
  })
  const audio = observeQuery(owner, queryCache, audioMetadataQuery, (result) => {
    metadata = available(result)
    updateMetadata()
  })
  const update = () => {
    const state = session.getSnapshot()
    const path = state.currentItem?.locator ?? ''
    const active = !!path && state.mode === 'audio'
    if (active && !detached) detached = host.attach(element, 'audio')
    if (!active && detached) {
      detached()
      detached = undefined
    }
    const nextPath = active ? path : ''
    if (selectedPath !== nextPath) {
      selectedPath = nextPath
      if (active) {
        seedQuery(
          playbackFilesQuery,
          parentPath(path),
          ['files', parentPath(path)],
          directoryFilesSchema,
        )
        seedQuery(audioMetadataQuery, path, ['audio-metadata', 'v2', path], audioMetadataSchema)
      }
      directory.select(active ? parentPath(path) : undefined)
      audio.select(active ? path : undefined)
    }
    const signature = `${path}\0${state.mode}`
    if (path && window.location.pathname === '/' && signature !== observedItem) {
      observedItem = signature
      const params = new URLSearchParams(window.location.search)
      const audioOnly = state.currentItem?.media === 'video' && state.mode === 'audio'
      if (
        params.has('playing') &&
        (params.get('playing') !== path || (params.get('audioOnly') === 'true') !== audioOnly)
      ) {
        navigateSearchParams({ playing: path, audioOnly: audioOnly ? 'true' : null }, 'replace')
      }
    }
    updateMetadata()
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => session.dispatch({ type: 'play' }))
    navigator.mediaSession.setActionHandler('pause', () => session.dispatch({ type: 'pause' }))
    navigator.mediaSession.setActionHandler('seekbackward', (details) =>
      session.dispatch({
        type: 'seek',
        position: Math.max(0, session.getSnapshot().position - (details.seekOffset || 10)),
      }),
    )
    navigator.mediaSession.setActionHandler('seekforward', (details) =>
      session.dispatch({
        type: 'seek',
        position: Math.min(
          session.getSnapshot().duration || Infinity,
          session.getSnapshot().position + (details.seekOffset || 10),
        ),
      }),
    )
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) session.dispatch({ type: 'seek', position: details.seekTime })
    })
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      session.dispatch({ type: 'previous' }),
    )
    navigator.mediaSession.setActionHandler('nexttrack', () => session.dispatch({ type: 'next' }))
  }
  owner.own(session.subscribe(update))
  update()
  return () => {
    detached?.()
    owner.dispose()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      for (const action of actions) navigator.mediaSession.setActionHandler(action, null)
    }
  }
})
export const PlaybackMediaHost = view(() =>
  observe(playbackSource, (snapshot) => (
    <audio
      use={audioHost}
      preload='auto'
      class='hidden'
      data-playback-media-host='audio'
      data-playback-source={snapshot.mode === 'audio' ? snapshot.source?.url : undefined}
      data-playback-audio-host
      data-workspace-taskbar-media-audio
    />
  )),
)
