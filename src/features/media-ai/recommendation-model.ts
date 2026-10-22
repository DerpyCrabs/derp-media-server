import { Schema } from 'effect'
import { MediaType, type FileItem } from '@/lib/files/types'

const optionalNumber = Schema.optional(Schema.NullOr(Schema.Number))
const fields = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.Enum(MediaType),
  size: Schema.optional(Schema.Number),
  extension: Schema.optional(Schema.String),
  isDirectory: Schema.optional(Schema.Boolean),
  id: optionalNumber,
  readingProgress: optionalNumber,
  lastRead: optionalNumber,
  pageIndex: optionalNumber,
  description: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  duration: optionalNumber,
  plays: optionalNumber,
  displayTitle: Schema.optional(Schema.String),
  subtitle: Schema.optional(Schema.String),
  previewKind: Schema.optional(Schema.String),
  liked: Schema.optional(Schema.Boolean),
  previewPath: Schema.optional(Schema.String),
  itemCount: optionalNumber,
})
export type Recommendation = typeof fields.Type & { members?: Recommendation[] }
export const recommendationSchema: Schema.Codec<Recommendation> = Schema.Struct({
  ...fields.fields,
  members: Schema.optional(
    Schema.mutable(Schema.Array(Schema.suspend(() => recommendationSchema))),
  ),
})
export const recommendationPageSchema = Schema.Struct({
  rows: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        title: Schema.String,
        items: Schema.mutable(Schema.Array(recommendationSchema)),
      }),
    ),
  ),
  generatedAt: optionalNumber,
  feedId: Schema.optional(Schema.String),
  resumeCursor: optionalNumber,
  warming: Schema.optional(Schema.Boolean),
  profileResetAt: optionalNumber,
  nextCursor: optionalNumber,
})
export const refreshRecommendationSchema = Schema.Union([
  recommendationPageSchema,
  Schema.Struct({ ok: Schema.Boolean }),
])
export const libraryAnswerSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(recommendationSchema)),
  message: Schema.String,
  intent: Schema.String,
})
export const readingBooksSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(recommendationSchema)),
})
export const pageParamSchema = Schema.Struct({
  cursor: Schema.Number,
  feedId: Schema.optional(Schema.NullOr(Schema.String)),
})
export const initialRecommendationPagesSchema = Schema.Struct({
  pages: Schema.mutable(Schema.Array(recommendationPageSchema)),
  pageParams: Schema.mutable(Schema.Array(pageParamSchema)),
})
export type Home = typeof recommendationPageSchema.Type
export type Answer = typeof libraryAnswerSchema.Type
export type PageParam = typeof pageParamSchema.Type
export type HomePages = typeof initialRecommendationPagesSchema.Type
export type Category = 'all' | 'music' | 'video' | 'books'
export type ForYouProps = {
  actions?: HTMLDivElement
  aiEnabled: boolean
  searchOpen: boolean
  onOpenFolder: () => void
}
export const categories = [
  { id: 'all', title: 'All' },
  { id: 'music', title: 'Music' },
  { id: 'video', title: 'Videos' },
  { id: 'books', title: 'Books' },
] as const

export function isReading(item: { type: MediaType }) {
  return item.type === MediaType.BOOK || item.type === MediaType.PDF
}
export function preparePage(page: Home): Home {
  return {
    ...page,
    rows: page.rows.map((row) => ({
      ...row,
      items: row.items.filter(
        (item) =>
          item.type === MediaType.AUDIO ||
          item.type === MediaType.VIDEO ||
          isReading(item) ||
          item.type === MediaType.FOLDER,
      ),
    })),
  }
}
export function asFile(item: Recommendation): FileItem {
  return {
    name: item.name,
    path: item.path,
    type: item.type,
    isDirectory: item.type === MediaType.FOLDER,
    size: item.size ?? 0,
    extension: item.extension ?? item.name.split('.').pop() ?? '',
  }
}
