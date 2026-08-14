import { filesystemResourceAddress, filesystemResourceKey } from '@/lib/domain/resource'
import { serverConfigQueryOptions, settingsQueryOptions } from '@/lib/query-options'
import type { ResourceContentInstance } from '@/lib/domain/content'
import { fileDownloadHref } from '@/lib/download-urls'
import { BUILT_IN_RENDERER_ID } from '@/src/features/open/renderer-registry'
import type {
  ContentRendererModule,
  ContentRendererMountContext,
} from '@/src/features/open/renderer-registry'
import { useQuery } from '@tanstack/solid-query'
import { createComponent, type Component, type JSX } from 'solid-js'

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
  const { ImageViewerContent } = await import('../../features/viewer/ImageViewerContent')
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
  const { TextViewerContent } = await import('../../features/viewer/TextViewerContent')
  return contentModule((context) =>
    createComponent(FilesystemTextMount, { context, Content: TextViewerContent }),
  )
}

export async function loadFilesystemReaderRenderer(): Promise<ContentRendererModule> {
  const { ReaderContent } = await import('../../features/reader/ReaderContent')
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
    return renderer === BUILT_IN_RENDERER_ID.folderReader
      ? 'folder'
      : renderer === BUILT_IN_RENDERER_ID.book
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
        return fileDownloadHref(resourcePath(context))
      },
      onClose: context.close,
    }),
  )
}

export function filesystemRendererLoader(
  rendererId: string,
): (() => Promise<ContentRendererModule>) | null {
  switch (rendererId) {
    case BUILT_IN_RENDERER_ID.image:
      return loadFilesystemImageRenderer
    case BUILT_IN_RENDERER_ID.text:
      return loadFilesystemTextRenderer
    case BUILT_IN_RENDERER_ID.pdf:
    case BUILT_IN_RENDERER_ID.book:
    case BUILT_IN_RENDERER_ID.folderReader:
      return loadFilesystemReaderRenderer
    case BUILT_IN_RENDERER_ID.unsupported:
      return loadFilesystemUnsupportedRenderer
    default:
      return null
  }
}
