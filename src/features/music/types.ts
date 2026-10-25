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

export type PlaylistSummary = (typeof import('./schemas').playlistsSchema.Type)['items'][number]
export type Playlist = typeof import('./schemas').playlistSchema.Type
