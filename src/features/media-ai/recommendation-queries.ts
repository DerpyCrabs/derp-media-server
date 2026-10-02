import { Effect } from 'effect'
import { apiSchemaEffect } from '@/lib/api/client'
import { groups } from '@/lib/api/cache'
import {
  recommendationPageSchema,
  readingBooksSchema,
  preparePage,
  type Home,
  type PageParam,
} from './recommendation-model'
import { infiniteQuery, query } from '@effectweb/query'

export function homeKey(category: string) {
  return category === 'all' || category === 'music'
    ? ['media-ai', 'home']
    : ['media-ai', 'home', category]
}
export function loadPage(param: PageParam, category = 'all') {
  return Effect.suspend(() => {
    const params = new URLSearchParams({
      category,
      hour: String(new Date().getHours()),
      cursor: String(param.cursor),
    })
    if (param.feedId) params.set('feedId', param.feedId)
    return apiSchemaEffect(recommendationPageSchema, `/api/media-ai/home?${params}`).pipe(
      Effect.map(preparePage),
    )
  })
}
export const homeQuery = infiniteQuery<string, Home, PageParam, Error>({
  name: 'recommendations',
  groups: [groups.recommendations],
  initial: { cursor: 0 },
  load: (category, param) => loadPage(param, category),
  next: (page) =>
    page.nextCursor == null ? undefined : { cursor: page.nextCursor, feedId: page.feedId },
  staleTime: Infinity,
})
export const readingQuery = query({
  name: 'reading-books',
  groups: [groups.mediaAi],
  staleTime: 0,
  load: () => apiSchemaEffect(readingBooksSchema, '/api/media-ai/books'),
})
