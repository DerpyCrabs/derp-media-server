import {
  filesystemResourceAddress,
  filesystemResourceKey,
  type ResourceKey,
} from '@/lib/domain/resource'
import { serverConfigQueryOptions, settingsQueryOptions } from '@/lib/query-options'
import type { ResourceContentInstance } from '@/lib/domain/content'
import { filesystemDownloadHref } from './download'
import type {
  ContentRendererModule,
  ContentRendererMountContext,
  RendererDescriptor,
} from '@/src/features/open/renderer-registry'
import { useQuery } from '@tanstack/solid-query'
import { createComponent, type Component, type JSX } from 'solid-js'

export const FILESYSTEM_RENDERER_ID = {
  audio: 'audio-player',
  video: 'video-player',
  image: 'image-viewer',
  text: 'text-viewer',
  pdf: 'pdf-reader',
  book: 'book-reader',
  folderReader: 'folder-reader',
  unsupported: 'unsupported-file',
} as const

function resourceInstance(context: ContentRendererMountContext): ResourceContentInstance {
  const instance = context.instance()
  if (instance.type !== 'resource') throw new Error('Filesystem renderer requires resource content')
  if (!filesystemResourceAddress(instance.resource)) {
    throw new Error('Filesystem renderer received an invalid resource key')
  }
  return instance
}

function resourcePath(context: ContentRendererMountContext): string {
  return filesystemResourceAddress(resourceInstance(context).resource)!.path
}

function directoryPath(context: ContentRendererMountContext): string {
  const instance = resourceInstance(context)
  const explicit = instance.context ? filesystemResourceAddress(instance.context)?.path : undefined
  if (explicit !== undefined) return explicit
  return resourcePath(context).replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

function replacePath(context: ContentRendererMountContext, path: string) {
  const current = resourceInstance(context)
  const address = filesystemResourceAddress(current.resource)!
  context.replace({
    ...current,
    resource: filesystemResourceKey(address.rootId, path),
  })
}

function contentModule(
  mount: (context: ContentRendererMountContext) => JSX.Element,
): ContentRendererModule {
  return { kind: 'content', mount }
}

export async function loadFilesystemImageRenderer(): Promise<ContentRendererModule> {
  const { ImageViewerContent } = await import('./viewers/ImageViewerContent')
  return contentModule((context) =>
    createComponent(ImageViewerContent, {
      get viewingPath() {
        return resourcePath(context)
      },
      get directory() {
        return directoryPath(context)
      },
      get active() {
        return context.active()
      },
      onNavigate: (path) => replacePath(context, path),
      onClose: context.close,
    }),
  )
}

type TextContentComponent = Component<{
  contentInstanceId: string
  resource: ResourceKey
  viewingPath: string
  editableFolders: string[]
  knowledgeBases?: string[]
  onClose?: () => void
}>

type ReaderContentComponent = Component<{
  sourcePath: string
  sourceKind: 'pdf' | 'folder' | 'book'
  showClose?: boolean
  onClose?: () => void
  closeOnEscape?: boolean
}>

function FilesystemTextMount(props: {
  context: ContentRendererMountContext
  Content: TextContentComponent
}) {
  const config = useQuery(serverConfigQueryOptions)
  const settings = useQuery(settingsQueryOptions)
  return createComponent(props.Content, {
    get contentInstanceId() {
      return resourceInstance(props.context).id
    },
    get resource() {
      return resourceInstance(props.context).resource
    },
    get viewingPath() {
      return resourcePath(props.context)
    },
    get editableFolders() {
      return config.data?.editableFolders ?? []
    },
    get knowledgeBases() {
      return settings.data?.knowledgeBases
    },
    onClose: props.context.close,
  })
}

export async function loadFilesystemTextRenderer(): Promise<ContentRendererModule> {
  const { TextViewerContent } = await import('./viewers/TextViewerContent')
  return contentModule((context) =>
    createComponent(FilesystemTextMount, { context, Content: TextViewerContent }),
  )
}

export async function loadFilesystemReaderRenderer(): Promise<ContentRendererModule> {
  const { ReaderContent } = await import('./viewers/ReaderContent')
  return contentModule((context) =>
    createComponent(FilesystemReaderMount, { context, Content: ReaderContent }),
  )
}

function FilesystemReaderMount(props: {
  context: ContentRendererMountContext
  Content: ReaderContentComponent
}) {
  const sourceKind = () => {
    const renderer = resourceInstance(props.context).renderer
    return renderer === FILESYSTEM_RENDERER_ID.folderReader
      ? 'folder'
      : renderer === FILESYSTEM_RENDERER_ID.book
        ? 'book'
        : 'pdf'
  }
  return (
    <div
      role='dialog'
      aria-label={`Reader: ${resourcePath(props.context).split(/[/\\]/).filter(Boolean).at(-1) ?? resourcePath(props.context)}`}
      data-reader-shell
      data-testid='reader-dialog'
      class='relative h-full min-h-0 overflow-hidden bg-neutral-900'
    >
      {createComponent(props.Content, {
        get sourcePath() {
          return resourcePath(props.context)
        },
        get sourceKind() {
          return sourceKind()
        },
        showClose: Boolean(props.context.close),
        onClose: props.context.close,
        closeOnEscape: Boolean(props.context.close),
      })}
    </div>
  )
}

export async function loadFilesystemUnsupportedRenderer(): Promise<ContentRendererModule> {
  const { UnsupportedViewerContent } =
    await import('../../features/viewer/UnsupportedViewerContent')
  return contentModule((context) =>
    createComponent(UnsupportedViewerContent, {
      get name() {
        return resourcePath(context).split(/[/\\]/).filter(Boolean).at(-1) ?? resourcePath(context)
      },
      get extension() {
        const name = resourcePath(context).split(/[/\\]/).filter(Boolean).at(-1) ?? ''
        return name.includes('.') ? name.split('.').at(-1) : undefined
      },
      get downloadHref() {
        return filesystemDownloadHref(resourcePath(context))
      },
      onClose: context.close,
    }),
  )
}

const defaultAndView = ['default', 'view'] as const
const defaultViewAndRead = ['default', 'view', 'read'] as const
const defaultViewAndPlay = ['default', 'view', 'play'] as const

export const filesystemRendererDescriptors: readonly RendererDescriptor[] = [
  {
    id: FILESYSTEM_RENDERER_ID.folderReader,
    rules: [{ type: 'kind', value: 'folder', intents: ['read'] }],
    requiresAnyCapability: ['browse'],
    load: loadFilesystemReaderRenderer,
  },
  {
    id: FILESYSTEM_RENDERER_ID.video,
    rules: [
      { type: 'mime', value: 'video/ogg', intents: defaultViewAndPlay },
      { type: 'mime', value: 'application/ogg', intents: defaultViewAndPlay },
      { type: 'mimePrefix', value: 'video/', intents: defaultViewAndPlay },
      { type: 'presentation', value: 'video', intents: defaultViewAndPlay },
    ],
    requiresAnyCapability: ['stream', 'read'],
    load: async () => {
      const module = await import('../../media/VideoPlayer')
      return { kind: 'playback', media: 'video', component: module.VideoPlayer }
    },
  },
  {
    id: FILESYSTEM_RENDERER_ID.audio,
    rules: [
      { type: 'mimePrefix', value: 'audio/', intents: defaultViewAndPlay },
      { type: 'presentation', value: 'audio', intents: defaultViewAndPlay },
    ],
    requiresAnyCapability: ['stream', 'read'],
    load: async () => {
      const module = await import('../../media/AudioPlayer')
      return { kind: 'playback', media: 'audio', component: module.AudioPlayer }
    },
  },
  {
    id: FILESYSTEM_RENDERER_ID.image,
    rules: [
      { type: 'mimePrefix', value: 'image/', intents: defaultAndView },
      { type: 'presentation', value: 'image', intents: defaultAndView },
    ],
    requiresAnyCapability: ['read'],
    load: loadFilesystemImageRenderer,
  },
  {
    id: FILESYSTEM_RENDERER_ID.text,
    rules: [
      { type: 'mimePrefix', value: 'text/', intents: defaultAndView },
      { type: 'mime', value: 'application/json', intents: defaultAndView },
      { type: 'mime', value: 'application/xml', intents: defaultAndView },
      { type: 'mime', value: 'application/javascript', intents: defaultAndView },
      { type: 'mime', value: 'application/typescript', intents: defaultAndView },
      { type: 'presentation', value: 'text', intents: defaultAndView },
    ],
    requiresAnyCapability: ['read'],
    load: loadFilesystemTextRenderer,
  },
  {
    id: FILESYSTEM_RENDERER_ID.pdf,
    rules: [
      { type: 'mime', value: 'application/pdf', intents: defaultViewAndRead },
      { type: 'presentation', value: 'pdf', intents: defaultViewAndRead },
    ],
    requiresAnyCapability: ['read'],
    load: loadFilesystemReaderRenderer,
  },
  {
    id: FILESYSTEM_RENDERER_ID.book,
    rules: [
      { type: 'mime', value: 'application/epub+zip', intents: defaultViewAndRead },
      { type: 'mime', value: 'application/x-fictionbook+xml', intents: defaultViewAndRead },
      { type: 'presentation', value: 'book', intents: defaultViewAndRead },
    ],
    requiresAnyCapability: ['read'],
    load: loadFilesystemReaderRenderer,
  },
  {
    id: FILESYSTEM_RENDERER_ID.unsupported,
    rules: [{ type: 'fallback', intents: defaultAndView }],
    requiresAnyCapability: ['read', 'download'],
    load: loadFilesystemUnsupportedRenderer,
  },
]
