import { useQueryClient } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/api/query-keys'
import { fetchDirectoryFiles } from '@/lib/files/files-client'
import { createFileSortMetadata, sortFilesForPath } from '@/features/explorer/file-display-settings'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { useViewStats } from '@/features/explorer/use-view-stats'
import { MediaType } from '@/lib/files/types'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { ImageContent } from '../ImageContent'
import { PagedReader, type PagedDocument } from '../paged/PagedReader'
import type { ReaderPage } from '../../reader-position'
import type { ReaderContentProps } from '../../reader-types'

const loadImageSize = (source: string, signal: AbortSignal) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image()
    let settled = false
    const finish = (size: { width: number; height: number }) => {
      if (settled) return
      settled = true
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', abort)
      resolve(size)
    }
    const abort = () => {
      image.src = ''
      finish({ width: 900, height: 1200 })
    }
    image.onload = () =>
      finish({ width: image.naturalWidth || 900, height: image.naturalHeight || 1200 })
    image.onerror = () => finish({ width: 900, height: 1200 })
    if (signal.aborted) abort()
    else {
      signal.addEventListener('abort', abort, { once: true })
      image.src = source
    }
  })

export default function DirectoryReader(props: ReaderContentProps) {
  const queryClient = useQueryClient()
  const { settingsQuery } = useExplorerSettings()
  const viewStats = useViewStats()
  const load = async (path: string, signal: AbortSignal): Promise<PagedDocument> => {
    const [payload, settings, views] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: queryKeys.files(path),
        queryFn: ({ signal }) => fetchDirectoryFiles(path, signal),
      }),
      (settingsQuery.data
        ? Promise.resolve(settingsQuery.data)
        : settingsQuery.refetch().then((result) => result.data)
      ).catch(() => undefined),
      (viewStats.query.data
        ? Promise.resolve(viewStats.query.data.views)
        : viewStats.query.refetch().then((result) => result.data?.views ?? {})
      ).catch(() => ({})),
    ])
    signal.throwIfAborted()
    const files = sortFilesForPath(
      payload.files,
      path,
      settings?.sortOrders,
      false,
      createFileSortMetadata(settings?.favorites, views),
    ).filter((file) => !file.isDirectory && file.type === MediaType.IMAGE)
    if (!files.length) throw new Error('Folder contains no supported images')
    const pages = await Promise.all(
      files.map(async (file): Promise<ReaderPage> => {
        const source = buildMediaUrl(file.path.replace(/\\/g, '/'))
        return {
          id: file.path,
          name: file.name,
          source,
          ...(await loadImageSize(source, signal)),
          kind: 'image',
        }
      }),
    )
    return { pages, outline: [] }
  }

  return (
    <PagedReader
      {...props}
      load={load}
      selectionModes={['image']}
      renderPage={({ page, zoom, frame }) => (
        <ImageContent
          page={page}
          zoom={zoom}
          selectionMode={frame.selectionMode()}
          onRegion={frame.selectRegion}
        />
      )}
    />
  )
}
