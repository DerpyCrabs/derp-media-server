import type { ResourceSummary, ViewerId } from '@/lib/resource'
import { MediaType } from '@/lib/types'

export type { ViewerId } from '@/lib/resource'

export type ViewerLoadFactory = () => Promise<unknown>

type ViewerDescriptorBase = Readonly<{
  id: ViewerId
  load: ViewerLoadFactory
}>

export type ViewerDescriptor =
  | (ViewerDescriptorBase & { role: 'playback'; media: 'audio' | 'video' })
  | (ViewerDescriptorBase & { role: 'viewer' })
  | (ViewerDescriptorBase & { role: 'conversation' })

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
}>

const descriptors = {
  audio: {
    id: 'audio-player',
    role: 'playback',
    media: 'audio',
    load: () => import('../media/AudioPlayer'),
  },
  video: {
    id: 'video-player',
    role: 'playback',
    media: 'video',
    load: () => import('../media/VideoPlayer'),
  },
  image: {
    id: 'image-viewer',
    role: 'viewer',
    load: () => import('../media/ImageViewerDialog'),
  },
  text: {
    id: 'text-viewer',
    role: 'viewer',
    load: () => import('../media/TextViewerDialog'),
  },
  pdf: {
    id: 'pdf-reader',
    role: 'viewer',
    load: () => import('../reader/ReaderDialog'),
  },
  book: {
    id: 'book-reader',
    role: 'viewer',
    load: () => import('../reader/ReaderDialog'),
  },
  folderReader: {
    id: 'folder-reader',
    role: 'viewer',
    load: () => import('../reader/ReaderDialog'),
  },
  conversation: {
    id: 'conversation',
    role: 'conversation',
    load: () => import('../workspace/HermesChatPane'),
  },
  unsupported: {
    id: 'unsupported-file',
    role: 'viewer',
    load: () => import('../media/UnsupportedFileViewerDialog'),
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
