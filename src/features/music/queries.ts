import { apiSchemaEffect } from '@/lib/api/client'
import { groups, seedQuery } from '@/lib/api/cache'
import { indexingStatusSchema, musicHomeSchema } from './schemas'
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
