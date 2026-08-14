import { useQuery } from '@tanstack/solid-query'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { filesystemResourceAddress } from '@/lib/domain/resource'
import type { ResourceContentInstance } from '@/lib/domain/content'
import type {
  ContentSurfaceModule,
  ContentSurfaceMountContext,
} from '@/src/features/content/contracts'
import {
  ResourceViewerContent,
  type ResourceViewerAdapter,
} from '@/src/features/viewer/ResourceViewerContent'
import { buildAudioMetadataUrl, buildMediaUrl } from '@/lib/api-media-urls'
import { filesystemDownloadHref } from './download'
import {
  createFilesystemPlaybackItem,
  filesystemAudioPlaybackQueue,
  filesystemPlaybackItemPath,
} from './playback'
import { filesystemResourcesQueryOptions } from './query-options'
import {
  filesystemPathForResourceKey,
  filesystemResourceKeyForPath,
  filesystemResourceMediaType,
} from './resource'

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

function FilesystemContentSurface(props: { context: ContentSurfaceMountContext }) {
  const context = props.context
  const resourcesQuery = useQuery(() => ({
    ...filesystemResourcesQueryOptions({ dir: surfaceDirectory(context) }),
    enabled: getMediaTypeFromPath(surfacePath(context)) === MediaType.AUDIO,
  }))

  return (
    <ResourceViewerContent
      runtime={context.runtime}
      contentInstance={() => surfaceContent(context)}
      contentVisible={context.visible}
      viewingPath={() => surfacePath(context)}
      directory={() => surfaceDirectory(context)}
      active={context.active}
      onReplaceContent={context.replace}
      onNavigateViewing={(path) => navigateSurface(context, path)}
      onVideoMetadataLoaded={context.resize}
      autoPlayVideo={context.autoPlay}
      onListenOnlyDismissViewer={context.detach}
      showListenOnly={Boolean(context.detach)}
      onAudioActivate={context.activate}
      onClose={context.close}
      resources={() => resourcesQuery.data?.resources ?? []}
      adapter={adapter}
    />
  )
}

function surfaceContent(context: ContentSurfaceMountContext): ResourceContentInstance {
  const instance = context.instance()
  if (instance.type !== 'resource' || !filesystemResourceAddress(instance.resource)) {
    throw new Error('Filesystem surface requires resource content')
  }
  return instance
}

function surfacePath(context: ContentSurfaceMountContext): string {
  return filesystemResourceAddress(surfaceContent(context).resource)!.path
}

function surfaceDirectory(context: ContentSurfaceMountContext): string {
  const instance = surfaceContent(context)
  const explicit = instance.context ? filesystemResourceAddress(instance.context)?.path : undefined
  return explicit ?? surfacePath(context).replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

function navigateSurface(context: ContentSurfaceMountContext, path: string) {
  const current = surfaceContent(context)
  const address = filesystemResourceAddress(current.resource)!
  const resource = filesystemResourceKeyForPath(path, address.rootId)
  if (context.navigate) {
    context.navigate(resource)
    return
  }
  context.replace({ ...current, resource })
}

export const filesystemContentSurfaceModule: ContentSurfaceModule = {
  mount: (context) => <FilesystemContentSurface context={context} />,
}
