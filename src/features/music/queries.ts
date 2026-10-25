import { apiSchemaEffect } from '@/lib/api/client'
import { groups, seedQuery } from '@/lib/api/cache'
import {
  indexingStatusSchema,
  musicHomeSchema,
  playlistsSchema,
  playlistSchema,
  musicSearchSchema,
} from './schemas'
import { query } from '@effectweb/query'
export type { IndexingStatus } from './schemas'
export const mediaAiStatusQuery = query({
  name: 'media-ai-status',
  groups: [groups.mediaAi],
  staleTime: 10_000,
  load: () => apiSchemaEffect(indexingStatusSchema, '/api/media-ai/status'),
})
export const musicHomeQuery = query({
  name: 'music-home',
  groups: [groups.music],
  staleTime: Infinity,
  load: (genre: string) =>
    apiSchemaEffect(musicHomeSchema, `/api/music/home?genre=${encodeURIComponent(genre)}`),
})
seedQuery(mediaAiStatusQuery, true, ['media-ai', 'status'], indexingStatusSchema)
seedQuery(musicHomeQuery, '', ['music', 'home', ''], musicHomeSchema)

export const playlistsQuery = query({
  name: 'music-playlists',
  groups: [groups.playlists],
  staleTime: 0,
  load: () => apiSchemaEffect(playlistsSchema, '/api/music/playlists'),
})
export const playlistQuery = query({
  name: 'music-playlist',
  groups: [groups.playlists],
  staleTime: 0,
  load: (id: string) =>
    apiSchemaEffect(playlistSchema, `/api/music/playlists/${encodeURIComponent(id)}`),
})
export const musicSearchQuery = query({
  name: 'music-search',
  groups: [groups.music],
  staleTime: 30_000,
  load: (input: { q: string; offset: number }) =>
    apiSchemaEffect(
      musicSearchSchema,
      `/api/music/tracks?q=${encodeURIComponent(input.q)}&offset=${input.offset}`,
    ),
})
