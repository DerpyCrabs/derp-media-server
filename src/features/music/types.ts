export type MusicTrack = {
  path: string
  name: string
  title: string
  artist: string
  album: string
  albumArtist: string
  genre: string[]
  genreSource: string
  duration: number
  trackNumber: number
  year: number
  liked: boolean
  plays: number
  lastPlayed: number
  reason: string
  hasArtwork?: boolean
}

export type PlaylistRules = {
  genre: string
  artist: string
  liked: boolean
  unplayed: boolean
  notPlayedDays: number
  limit: number
}

export type PlaylistSummary = {
  id: string
  name: string
  rules: PlaylistRules | null
  count: number
  lastPlayed: number
  preview?: MusicTrack
}

export type Playlist = PlaylistSummary & { items: MusicTrack[] }
export type MusicHomeData = {
  radio: {
    tracks: MusicTrack[]
    stations: { genre: string; artist: string; items: string[] }[]
  }
  rows: { id: string; title: string; items: MusicTrack[] }[]
  albums: { title: string; artist: string; items: MusicTrack[]; cover?: MusicTrack }[]
  genres: string[]
  mixes: { genre: string; count: number; items: MusicTrack[] }[]
  genreViews: Record<string, Pick<MusicHomeData, 'rows' | 'albums' | 'mixes'>>
  total: number
  searchEnabled: boolean
  aiEnabled: boolean
  paused: boolean
  curationError?: string | null
}
