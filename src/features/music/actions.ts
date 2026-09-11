import { createSignal } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import { radioTracks, recordingKey } from './radio'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import type { PlaybackSession, QueueContext, RadioOptions } from '@/features/playback/types'
import type { MusicHomeData, MusicTrack } from './types'

export type MusicDialog = { kind: 'collection'; title: string; items: MusicTrack[] }

export const [musicDialog, setMusicDialog] = createSignal<MusicDialog | null>(null)
export const [musicNotice, setMusicNotice] = createSignal('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
export function notifyMusic(message: string) {
  setMusicNotice(message)
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => setMusicNotice(''), 5000)
}

export function musicItem(track: Pick<MusicTrack, 'path' | 'title'>) {
  return { locator: track.path, name: track.title, media: 'audio' as const }
}

export function playMusic(
  session: PlaybackSession,
  tracks: MusicTrack[],
  context: QueueContext,
  index = 0,
) {
  const track = tracks[index]
  if (!track) {
    notifyMusic('There are no tracks to play yet')
    return
  }
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
  navigateSearchParams({ playing: track.path, audioOnly: null }, 'push')
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
      id: crypto.randomUUID(),
      radio: { ...defaultRadio, seeds: [current.locator] },
    },
  })
}

export function startRadio(
  session: PlaybackSession,
  client: QueryClient,
  options: Partial<RadioOptions>,
  title: string,
) {
  const home = client.getQueryData<MusicHomeData>(['music', 'home', ''])
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
  playMusic(session, tracks, { kind: 'radio', title, id: crypto.randomUUID(), radio })
  session.dispatch({ type: 'setRepeat', repeat: false })
}

export function musicError(error: unknown) {
  notifyMusic(error instanceof Error ? error.message : 'Could not complete that change')
}
