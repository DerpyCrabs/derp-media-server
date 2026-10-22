import type { musicTrackSchema, musicHomeSchema } from './schemas'
export type MusicTrack = typeof musicTrackSchema.Type
export type MusicHomeData = typeof musicHomeSchema.Type

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
