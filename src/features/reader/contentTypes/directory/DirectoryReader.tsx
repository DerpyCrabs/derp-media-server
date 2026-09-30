import { view } from 'effectweb'
import { Effect } from 'effect'
import { queryCache } from '@/lib/api/cache'
import { settingsQuery, statsQuery } from '@/lib/api/queries'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import { createFileSortMetadata, sortFilesForPath } from '@/features/explorer/file-display-settings'
import { MediaType } from '@/lib/files/types'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { ImageContent } from '../ImageContent'
import { PagedReader, type PagedDocument } from '../paged/PagedReader'
import type { ReaderContentProps } from '../../reader-types'

const loadImageSize = (source: string) =>
  Effect.callback<{ width: number; height: number }>((resume) => {
    const image = new Image()
    image.onload = () =>
      resume(
        Effect.succeed({ width: image.naturalWidth || 900, height: image.naturalHeight || 1200 }),
      )
    image.onerror = () => resume(Effect.succeed({ width: 900, height: 1200 }))
    image.src = source
    return Effect.sync(() => {
      image.onload = null
      image.onerror = null
      image.src = ''
    })
  })

const load = (path: string): Effect.Effect<PagedDocument, unknown> =>
  Effect.gen(function* () {
    const [payload, settings, stats] = yield* Effect.all(
      [
        fetchDirectoryFilesEffect(path),
        queryCache
          .prefetch(settingsQuery, true)
          .pipe(Effect.catch(() => Effect.succeed(undefined))),
        queryCache
          .prefetch(statsQuery, true)
          .pipe(Effect.catch(() => Effect.succeed({ views: {} }))),
      ],
      { concurrency: 'unbounded' },
    )
    const files = sortFilesForPath(
      payload.files,
      path,
      settings?.sortOrders,
      false,
      createFileSortMetadata(settings?.favorites, stats.views),
    ).filter((file) => !file.isDirectory && file.type === MediaType.IMAGE)
    if (!files.length) return yield* Effect.fail(new Error('Folder contains no supported images'))
    const pages = yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const source = buildMediaUrl(file.path.replace(/\\/g, '/'))
          return {
            id: file.path,
            name: file.name,
            source,
            ...(yield* loadImageSize(source)),
            kind: 'image' as const,
          }
        }),
      { concurrency: 8 },
    )
    return { pages, outline: [] }
  })
const DirectoryReader = view<ReaderContentProps>((props) => (
  <PagedReader
    {...props}
    load={load}
    selectionModes={['image']}
    renderPage={({ page, zoom, frame }) => (
      <ImageContent
        page={page}
        zoom={zoom}
        selectionMode={frame.selectionMode}
        onRegion={frame.selectRegion}
      />
    )}
  />
))
export default DirectoryReader
