import { randomId } from '@/lib/random-id'
import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { musicHomeQuery } from './queries'
import { radioTracks, recordingKey } from './radio'
import { parentPath } from '@/lib/files/path-utils'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import type { PlaybackSession, QueueContext, RadioOptions } from '@/features/playback/types'
import type { MusicTrack } from './types'

export type MusicDialog = { kind: 'collection'; title: string; items: MusicTrack[] }

export type PlaylistRequest = { paths: readonly string[]; name: string }
const owner = modelOwner({
  dialog: null as MusicDialog | null,
  notice: '',
  playlists: null as PlaylistRequest | null,
})
const noticeSlot = 'music-notice'
export const musicUiSource = owner.source
export const musicUiLifetime = { dispose: owner.dispose, close: owner.close }
export const openPlaylists = (paths: readonly string[] = [], name = '') =>
  owner.patch({ dialog: null, playlists: { paths: [...new Set(paths)], name } })
export const closePlaylists = () => owner.patch({ playlists: null })
export const setMusicDialog = (dialog: MusicDialog | null) => owner.patch({ dialog })
export function notifyMusic(notice: string) {
  owner.patch({ notice })
  owner.run(
    noticeSlot,
    Effect.sleep(5000).pipe(Effect.andThen(Effect.sync(() => owner.patch({ notice: '' })))),
    'replace',
  )
}

export function musicItem(track: Pick<MusicTrack, 'path' | 'title'>) {
  return { locator: track.path, name: track.title, media: 'audio' as const }
}

export function playMusic(
  session: PlaybackSession,
  tracks: readonly MusicTrack[],
  context: QueueContext,
  index = 0,
) {
  const track = tracks[index]
  if (!track) {
    notifyMusic('There are no tracks to play yet')
    return
  }
  const params = new URLSearchParams(window.location.search)
  const defaultHome = !['view', 'dir', 'playing', 'viewing'].some((key) => params.has(key))
  session.dispatch({
    type: 'load',
    item: musicItem(track),
    queue: tracks.map((track, i) => ({
      ...musicItem(track),
      ...(context.kind === 'radio' && i !== index ? { automatic: true } : {}),
    })),
    queueContext: context,
    autoplay: true,
  })
  if (window.location.pathname === '/desktop' && params.get('mode') === 'viewer') {
    navigateSearchParams(
      { viewing: track.path, dir: parentPath(track.path), playing: null, audioOnly: null },
      'replace',
    )
    return
  }
  navigateSearchParams(
    { playing: track.path, audioOnly: null, ...(defaultHome ? { view: 'for-you' } : {}) },
    'push',
  )
}

export const defaultRadio: RadioOptions = {
  seeds: [],
  genre: '',
  artist: '',
  discovery: 0.35,
  strictGenre: false,
  allowRepeats: false,
}
export function continueRadio(session: PlaybackSession) {
  const current = session.getSnapshot().currentItem
  if (current?.media !== 'audio') return
  session.dispatch({ type: 'setRepeat', repeat: false })
  session.dispatch({
    type: 'setQueueContext',
    context: {
      kind: 'radio',
      title: `${current.name} radio`,
      id: randomId(),
      radio: { ...defaultRadio, seeds: [current.locator] },
    },
  })
}

export function startRadio(
  session: PlaybackSession,
  options: Partial<RadioOptions>,
  title: string,
) {
  const home = queryCache.getQueryData(musicHomeQuery, '')
  const radio = { ...defaultRadio, ...options }
  const selected = radioTracks(home, radio)
  if (!selected.length) {
    notifyMusic('No prepared songs for this station yet')
    return
  }
  const seed = home?.radio.tracks.find((track) => track.path === radio.seeds[0])
  const tracks = seed
    ? [seed, ...selected.filter((track) => recordingKey(track) !== recordingKey(seed))]
    : selected
  playMusic(session, tracks, { kind: 'radio', title, id: randomId(), radio })
  session.dispatch({ type: 'setRepeat', repeat: false })
}

export function musicError(error: unknown) {
  notifyMusic(error instanceof Error ? error.message : 'Could not complete that change')
}
