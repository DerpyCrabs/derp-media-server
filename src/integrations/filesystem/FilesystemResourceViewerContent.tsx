import { useQuery } from '@tanstack/solid-query'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import {
  ResourceViewerContent,
  type ResourceViewerAdapter,
  type ResourceViewerContentProps,
} from '@/src/features/viewer/ResourceViewerContent'
import { buildAudioMetadataUrl, buildMediaUrl } from '@/lib/api-media-urls'
import { filesystemDownloadHref } from './download'
import {
  createFilesystemPlaybackItem,
  filesystemAudioPlaybackQueue,
  filesystemPlaybackItemPath,
} from './playback'
import { filesystemResourcesQueryOptions } from './query-options'
import { filesystemPathForResourceKey, filesystemResourceMediaType } from './resource'

export type FilesystemResourceViewerContentProps = Omit<
  ResourceViewerContentProps,
  'adapter' | 'resources'
>

const adapter: ResourceViewerAdapter = {
  mediaType: getMediaTypeFromPath,
  downloadHref: filesystemDownloadHref,
  mediaUrl: buildMediaUrl,
  audioMetadataUrl: buildAudioMetadataUrl,
  resourcePath: (resource) => filesystemPathForResourceKey(resource.key),
  resourceMediaType: filesystemResourceMediaType,
  createPlaybackItem: (path, media) =>
    createFilesystemPlaybackItem({
      path,
      name: path.split(/[/\\]/).pop() ?? path,
      media,
    }),
  playbackItemPath: filesystemPlaybackItemPath,
  audioQueue: filesystemAudioPlaybackQueue,
}

export function FilesystemResourceViewerContent(props: FilesystemResourceViewerContentProps) {
  const resourcesQuery = useQuery(() => ({
    ...filesystemResourcesQueryOptions({ dir: props.directory?.() ?? '' }),
    enabled: getMediaTypeFromPath(props.viewingPath()) === MediaType.AUDIO && !!props.viewingPath(),
  }))

  return (
    <ResourceViewerContent
      runtime={props.runtime}
      contentInstance={props.contentInstance}
      contentVisible={props.contentVisible}
      viewingPath={props.viewingPath}
      readerKind={props.readerKind}
      directory={props.directory}
      active={props.active}
      onReplaceContent={props.onReplaceContent}
      onNavigateViewing={props.onNavigateViewing}
      onVideoMetadataLoaded={props.onVideoMetadataLoaded}
      autoPlayVideo={props.autoPlayVideo}
      onListenOnlyDismissViewer={props.onListenOnlyDismissViewer}
      showListenOnly={props.showListenOnly}
      onAudioActivate={props.onAudioActivate}
      onClose={props.onClose}
      resources={() => resourcesQuery.data?.resources ?? []}
      adapter={adapter}
    />
  )
}
