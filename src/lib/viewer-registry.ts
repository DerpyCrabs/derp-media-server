import type { ResourceSummary, ViewerId } from '@/lib/resource'
import { MediaType } from '@/lib/types'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'

export type { ViewerId } from '@/lib/resource'

export type ViewerLoadFactory = () => Promise<unknown>
export type ViewerPaneModule = Readonly<{
  default: typeof import('../workspace/WorkspaceViewerPane').WorkspaceViewerPane
}>
export type ViewerPaneLoadFactory = () => Promise<ViewerPaneModule>

type ViewerDescriptorBase = Readonly<{
  id: ViewerId
  load: ViewerLoadFactory
}>

export type ViewerDescriptor =
  | (ViewerDescriptorBase & {
      role: 'playback'
      media: 'audio' | 'video'
      pane?: ViewerPaneLoadFactory
    })
  | (ViewerDescriptorBase & { role: 'viewer'; pane?: ViewerPaneLoadFactory })
  | (ViewerDescriptorBase & { role: 'conversation' })

export type ViewerPaneDescriptor = ViewerDescriptor & { pane: ViewerPaneLoadFactory }

export type ViewerLookupIntent = 'default' | 'read'

export function viewerMediaType(viewerId: ViewerId): MediaType | null {
  switch (viewerId) {
    case 'audio-player':
      return MediaType.AUDIO
    case 'video-player':
      return MediaType.VIDEO
    case 'image-viewer':
      return MediaType.IMAGE
    case 'text-viewer':
      return MediaType.TEXT
    case 'pdf-reader':
      return MediaType.PDF
    case 'book-reader':
      return MediaType.BOOK
    case 'unsupported-file':
      return MediaType.OTHER
    case 'folder-reader':
    case 'conversation':
      return null
  }
}

export function viewerReaderKind(viewerId: ViewerId): 'pdf' | 'book' | 'folder' | null {
  if (viewerId === 'pdf-reader') return 'pdf'
  if (viewerId === 'book-reader') return 'book'
  if (viewerId === 'folder-reader') return 'folder'
  return null
}

export type ViewerRegistry = Readonly<{
  lookup(
    resource: Pick<ResourceSummary, 'kind' | 'mimeType' | 'presentation'>,
    intent?: ViewerLookupIntent,
  ): ViewerDescriptor | null
  byId?(viewerId: ViewerId): ViewerDescriptor | null
}>

const loadAudioPane: ViewerPaneLoadFactory = () => import('../spaces/viewer-panes/AudioViewerPane')
const loadVideoPane: ViewerPaneLoadFactory = () => import('../spaces/viewer-panes/VideoViewerPane')
const loadImagePane: ViewerPaneLoadFactory = () => import('../spaces/viewer-panes/ImageViewerPane')
const loadTextPane: ViewerPaneLoadFactory = () => import('../spaces/viewer-panes/TextViewerPane')
const loadReaderPane: ViewerPaneLoadFactory = () =>
  import('../spaces/viewer-panes/ReaderViewerPane')
const loadUnsupportedPane: ViewerPaneLoadFactory = () =>
  import('../spaces/viewer-panes/UnsupportedViewerPane')

const descriptors = {
  audio: {
    id: 'audio-player',
    role: 'playback',
    media: 'audio',
    load: loadAudioPane,
    pane: loadAudioPane,
  },
  video: {
    id: 'video-player',
    role: 'playback',
    media: 'video',
    load: loadVideoPane,
    pane: loadVideoPane,
  },
  image: {
    id: 'image-viewer',
    role: 'viewer',
    load: loadImagePane,
    pane: loadImagePane,
  },
  text: {
    id: 'text-viewer',
    role: 'viewer',
    load: loadTextPane,
    pane: loadTextPane,
  },
  pdf: {
    id: 'pdf-reader',
    role: 'viewer',
    load: loadReaderPane,
    pane: loadReaderPane,
  },
  book: {
    id: 'book-reader',
    role: 'viewer',
    load: loadReaderPane,
    pane: loadReaderPane,
  },
  folderReader: {
    id: 'folder-reader',
    role: 'viewer',
    load: loadReaderPane,
    pane: loadReaderPane,
  },
  conversation: {
    id: 'conversation',
    role: 'conversation',
    load: () => import('../workspace/HermesChatPane'),
  },
  unsupported: {
    id: 'unsupported-file',
    role: 'viewer',
    load: loadUnsupportedPane,
    pane: loadUnsupportedPane,
  },
} as const satisfies Record<string, ViewerDescriptor>

function isBrowsable(resource: Pick<ResourceSummary, 'kind' | 'presentation'>): boolean {
  return (
    resource.presentation === 'browse' ||
    resource.kind === 'library' ||
    resource.kind === 'source' ||
    resource.kind === 'folder' ||
    resource.kind === 'collection' ||
    resource.kind === 'conversationProject'
  )
}

function isConversation(resource: Pick<ResourceSummary, 'kind' | 'presentation'>): boolean {
  return (
    resource.kind === 'conversation' ||
    resource.kind === 'draft' ||
    resource.presentation === 'conversation'
  )
}

function descriptorForMime(mimeType: string | undefined): ViewerDescriptor | null {
  const mime = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (!mime) return null

  // Legacy extension classification checks video before audio for ambiguous OGG.
  if (mime === 'video/ogg' || mime === 'application/ogg') return descriptors.video
  if (mime.startsWith('video/')) return descriptors.video
  if (mime.startsWith('audio/')) return descriptors.audio
  if (mime.startsWith('image/')) return descriptors.image
  if (mime === 'application/pdf') return descriptors.pdf
  if (mime === 'application/epub+zip' || mime === 'application/x-fictionbook+xml') {
    return descriptors.book
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript'
  ) {
    return descriptors.text
  }
  return null
}

function descriptorForPresentation(
  presentation: ResourceSummary['presentation'],
): ViewerDescriptor | null {
  switch (presentation) {
    case 'audio':
      return descriptors.audio
    case 'video':
      return descriptors.video
    case 'image':
      return descriptors.image
    case 'text':
      return descriptors.text
    case 'pdf':
      return descriptors.pdf
    case 'book':
      return descriptors.book
    case 'conversation':
      return descriptors.conversation
    case 'unsupported':
      return descriptors.unsupported
    case 'browse':
      return null
  }
}

export const builtInViewerRegistry: ViewerRegistry = Object.freeze({
  byId(viewerId) {
    return Object.values(descriptors).find((descriptor) => descriptor.id === viewerId) ?? null
  },
  lookup(resource, intent = 'default') {
    if (intent === 'read') {
      if (resource.kind === 'folder') return descriptors.folderReader
      const descriptor =
        descriptorForMime(resource.mimeType) ?? descriptorForPresentation(resource.presentation)
      return descriptor?.id === 'pdf-reader' || descriptor?.id === 'book-reader' ? descriptor : null
    }

    if (isConversation(resource)) return descriptors.conversation
    if (isBrowsable(resource)) return null
    return descriptorForMime(resource.mimeType) ?? descriptorForPresentation(resource.presentation)
  },
})

export function viewerPaneDescriptorForWindow(
  window: Pick<WorkspaceWindowDefinition, 'viewerId' | 'initialState'> | undefined,
): ViewerPaneDescriptor | null {
  if (!window) return null
  const explicit = window.viewerId ? builtInViewerRegistry.byId?.(window.viewerId) : null
  if (explicit && 'pane' in explicit && explicit.pane) return explicit as ViewerPaneDescriptor
  const readerKind = window.initialState.readerKind
  const readerId =
    readerKind === 'folder'
      ? 'folder-reader'
      : readerKind === 'book'
        ? 'book-reader'
        : readerKind === 'pdf'
          ? 'pdf-reader'
          : null
  if (readerId) return builtInViewerRegistry.byId?.(readerId) as ViewerPaneDescriptor
  const media = getMediaTypeFromPath(window.initialState.viewing ?? '')
  const viewerId: ViewerId =
    media === MediaType.AUDIO
      ? 'audio-player'
      : media === MediaType.VIDEO
        ? 'video-player'
        : media === MediaType.IMAGE
          ? 'image-viewer'
          : media === MediaType.TEXT
            ? 'text-viewer'
            : media === MediaType.PDF
              ? 'pdf-reader'
              : media === MediaType.BOOK
                ? 'book-reader'
                : 'unsupported-file'
  return builtInViewerRegistry.byId?.(viewerId) as ViewerPaneDescriptor
}
