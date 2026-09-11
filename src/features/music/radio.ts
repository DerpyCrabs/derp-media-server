import type { RadioOptions } from '@/features/playback/types'
import type { MusicHomeData, MusicTrack } from './types'

export function recordingKey(track: MusicTrack) {
  return track.artist && track.title
    ? `${track.artist.trim().toLowerCase()}\0${track.title.trim().toLowerCase()}`
    : track.path
}

export function radioTracks(home: MusicHomeData | undefined, options: Partial<RadioOptions>) {
  if (!home?.radio) return []
  const tracks = new Map(home.radio.tracks.map((track) => [track.path, track]))
  const seeds = (options.seeds || []).flatMap((path) => tracks.get(path) || [])
  const stations = home.radio.stations.filter((station) => {
    if (options.genre) return station.genre.toLowerCase() === options.genre.toLowerCase()
    if (options.artist) return station.artist.toLowerCase() === options.artist.toLowerCase()
    return seeds.some(
      (track) =>
        (track.artist && station.artist.toLowerCase() === track.artist.toLowerCase()) ||
        track.genre.includes(station.genre),
    )
  })
  stations.sort((a, b) => Number(!a.artist) - Number(!b.artist))
  const seen = new Set<string>()
  return stations.flatMap((station) =>
    station.items.flatMap((path): MusicTrack[] => {
      const track = tracks.get(path)
      if (!track || seen.has(recordingKey(track))) return []
      seen.add(recordingKey(track))
      return [track]
    }),
  )
}
