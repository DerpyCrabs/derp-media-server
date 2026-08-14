import { isApiError } from '@/lib/api'
import {
  FILESYSTEM_PROVIDER,
  FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID,
  filesystemResourceAddress,
  filesystemResourceKey,
  isResourceKey,
  type ResourceError,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import {
  defineIntegrationModule,
  type ContentCategory,
  type ContentDecodeResult,
  type ContentInstance,
  type ResourceActionOutcome,
} from '@/src/features/content/contracts'
import { FILESYSTEM_RENDERER_ID, filesystemRendererDescriptors } from './renderers'
import { canCloseTextViewerContent } from '@/src/features/viewer/text-viewer-lifecycle'
import {
  browseIntegrationResource,
  inspectIntegrationResource,
  runIntegrationAction,
  uploadIntegrationFiles,
} from '@/src/integrations/http-client'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemPathForResourceKey,
  filesystemResourceIsDirectory,
  filesystemResourceKeyForPath,
  filesystemResourceMediaType,
} from './resource'
import {
  filesystemAudioPlaybackQueue,
  filesystemPlaybackItemFromResource,
  resolveFilesystemPlaybackSource,
} from './playback'
import { lazy } from 'solid-js'
import { MediaType } from '@/lib/types'

export {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemPathForResourceKey,
  filesystemResourceExtension,
  filesystemResourceIsDirectory,
  filesystemResourceMediaType,
} from './resource'

export const FILESYSTEM_CONTENT_CODEC_ID = 'filesystem.content'

const FilesystemPlaybackLifecycle = lazy(async () => ({
  default: (await import('./PlaybackSync')).FilesystemPlaybackSync,
}))

export type FilesystemIntegrationTransport = Readonly<{
  browseResource: typeof browseIntegrationResource
  inspectResource: typeof inspectIntegrationResource
  runResourceAction: typeof runIntegrationAction
  uploadFiles?(key: ResourceKey, files: readonly File[], signal?: AbortSignal): Promise<unknown>
}>

const actionDescriptors = [
  {
    id: 'filesystem.createFile',
    operation: 'createFile',
    label: 'Create new file',
    capability: 'filesystem.create',
    interaction: 'name',
  },
  {
    id: 'filesystem.createFolder',
    operation: 'createFolder',
    label: 'Create new folder',
    capability: 'filesystem.create',
    interaction: 'name',
  },
  {
    id: 'filesystem.upload',
    operation: 'upload',
    label: 'Upload',
    capability: 'filesystem.upload',
    interaction: 'upload',
  },
  {
    id: 'filesystem.paste',
    operation: 'paste',
    label: 'Paste',
    capability: 'filesystem.paste',
    interaction: 'paste',
  },
  {
    id: 'filesystem.rename',
    operation: 'rename',
    label: 'Rename',
    capability: 'filesystem.rename',
    interaction: 'name',
    optimisticEffect: 'rename',
  },
  {
    id: 'filesystem.move',
    operation: 'move',
    label: 'Move to...',
    capability: 'filesystem.move',
    interaction: 'destination',
  },
  {
    id: 'filesystem.copy',
    operation: 'copy',
    label: 'Copy to...',
    capability: 'filesystem.copy',
    interaction: 'destination',
  },
  {
    id: 'filesystem.delete',
    operation: 'delete',
    label: 'Delete',
    capability: 'filesystem.delete',
    dangerous: true,
    optimisticEffect: 'delete',
    interaction: 'immediate',
  },
  {
    id: 'filesystem.download',
    operation: 'download',
    label: 'Download',
    capability: 'download',
    interaction: 'immediate',
  },
] as const

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function resourceError(error: unknown, resource?: ResourceSummary): ResourceError {
  if (isApiError(error)) {
    return {
      schemaVersion: 1,
      code:
        error.status === 404
          ? 'notFound'
          : error.status >= 500
            ? 'unavailable'
            : error.status === 400
              ? 'badRequest'
              : 'internal',
      message: error.message,
      ...(resource ? { resource: resource.key } : {}),
      retryable: error.status >= 500,
    }
  }
  return {
    schemaVersion: 1,
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
    ...(resource ? { resource: resource.key } : {}),
  }
}

function badResourceRequest(message: string, resource: ResourceSummary): ResourceError {
  return {
    schemaVersion: 1,
    code: 'badRequest',
    message,
    resource: resource.key,
    retryable: false,
  }
}

function inputRecord(input: unknown): Record<string, unknown> {
  return record(input) ?? {}
}

export const defaultFilesystemIntegrationTransport: FilesystemIntegrationTransport = {
  browseResource: browseIntegrationResource,
  inspectResource: inspectIntegrationResource,
  runResourceAction: runIntegrationAction,
  uploadFiles: uploadIntegrationFiles,
}

function filesystemContentCodec() {
  return {
    id: FILESYSTEM_CONTENT_CODEC_ID,
    version: 1,
    supports(instance: ContentInstance) {
      return (
        (instance.type === 'explorer' && instance.location.provider === FILESYSTEM_PROVIDER) ||
        (instance.type === 'resource' && instance.resource.provider === FILESYSTEM_PROVIDER)
      )
    },
    encode(instance: ContentInstance) {
      if (instance.type === 'explorer') {
        const address = filesystemResourceAddress(instance.location)
        if (!address) throw new Error('Invalid filesystem Explorer resource key')
        return { kind: 'explorer', id: instance.id, address }
      }
      if (instance.type === 'resource') {
        const address = filesystemResourceAddress(instance.resource)
        if (!address) throw new Error('Invalid filesystem resource key')
        const contextAddress = instance.context ? filesystemResourceAddress(instance.context) : null
        if (instance.context && !contextAddress) {
          throw new Error('Invalid filesystem context resource key')
        }
        return {
          kind: 'resource',
          id: instance.id,
          address,
          renderer: instance.renderer,
          ...(contextAddress ? { contextAddress } : {}),
        }
      }
      throw new Error('Filesystem codec cannot encode integration content')
    },
    decode(value: unknown, encodedVersion: number): ContentDecodeResult {
      if (encodedVersion !== 1) {
        return {
          ok: false,
          reason: `Unsupported filesystem content version: ${encodedVersion}`,
          recoverable: value,
        }
      }
      const payload = record(value)
      if (payload?.kind === 'explorer') {
        const address = record(payload.address)
        if (
          typeof payload.id === 'string' &&
          typeof address?.rootId === 'string' &&
          typeof address.path === 'string'
        ) {
          try {
            return {
              ok: true,
              instance: {
                id: payload.id,
                type: 'explorer',
                location: filesystemResourceKeyForPath(address.path, address.rootId),
              },
            }
          } catch {}
        }
      }
      if (payload?.kind === 'resource') {
        const address = record(payload.address)
        const contextAddress = record(payload.contextAddress)
        if (
          typeof payload.id === 'string' &&
          typeof payload.renderer === 'string' &&
          typeof address?.rootId === 'string' &&
          typeof address.path === 'string'
        ) {
          try {
            return {
              ok: true,
              instance: {
                id: payload.id,
                type: 'resource',
                resource: filesystemResourceKeyForPath(address.path, address.rootId),
                renderer: payload.renderer,
                ...(typeof contextAddress?.rootId === 'string' &&
                typeof contextAddress.path === 'string'
                  ? {
                      context: filesystemResourceKeyForPath(
                        contextAddress.path,
                        contextAddress.rootId,
                      ),
                    }
                  : {}),
              },
            }
          } catch {}
        }
      }

      return { ok: false, reason: 'Invalid filesystem content', recoverable: value }
    },
  } as const
}

function titleFromPath(path: string, fallback: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? fallback
}

const rendererCategories: Readonly<Record<string, ContentCategory>> = {
  [FILESYSTEM_RENDERER_ID.folderReader]: 'folder',
  [FILESYSTEM_RENDERER_ID.audio]: 'audio',
  [FILESYSTEM_RENDERER_ID.video]: 'video',
  [FILESYSTEM_RENDERER_ID.image]: 'image',
  [FILESYSTEM_RENDERER_ID.text]: 'text',
  [FILESYSTEM_RENDERER_ID.pdf]: 'pdf',
  [FILESYSTEM_RENDERER_ID.book]: 'book',
  [FILESYSTEM_RENDERER_ID.unsupported]: 'file',
}

function filesystemContentCategory(instance: ContentInstance): ContentCategory {
  if (instance.type === 'explorer') return 'folder'
  return instance.type === 'resource' ? (rendererCategories[instance.renderer] ?? 'file') : 'file'
}

function filesystemLocationSummary(rootId: string, path: string): ResourceSummary {
  return {
    key: filesystemResourceKeyForPath(path, rootId),
    name: titleFromPath(path, 'Library'),
    kind: path ? 'folder' : 'root',
    capabilities: ['browse', 'filesystem.create', 'filesystem.upload', 'filesystem.paste'],
    presentation: 'browse',
    metadata: { logicalPath: path },
  }
}

export function createFilesystemIntegrationModule(
  transport: FilesystemIntegrationTransport = defaultFilesystemIntegrationTransport,
) {
  return defineIntegrationModule({
    id: FILESYSTEM_PROVIDER,
    name: 'Filesystem',
    root: filesystemLocationSummary(DEFAULT_FILESYSTEM_ROOT_ID, ''),
    browse: {
      browse: transport.browseResource,
    },
    inspect: {
      inspect: transport.inspectResource,
    },
    routes: {
      async open(resource, intent, context) {
        if (intent !== 'read' || context.surface !== 'library') return false
        const path = filesystemPathForResourceKey(resource.key)
        if (path === null) return false
        const readerKind = filesystemResourceIsDirectory(resource)
          ? 'folder'
          : filesystemResourceMediaType(resource) === MediaType.BOOK
            ? 'book'
            : filesystemResourceMediaType(resource) === MediaType.PDF
              ? 'pdf'
              : null
        if (readerKind === null) return false
        const { navigateSearchParams } = await import('@/src/browser-history')
        navigateSearchParams({ reader: path, readerKind }, 'push')
        return true
      },
    },
    playback: {
      createItem: filesystemPlaybackItemFromResource,
      createQueue: (resources, current) =>
        current.media === 'audio' ? filesystemAudioPlaybackQueue(resources, current) : [current],
      resolveSource: resolveFilesystemPlaybackSource,
      lifecycle: FilesystemPlaybackLifecycle,
    },
    actions: {
      list(resource) {
        return actionDescriptors
          .filter((action) => resource.capabilities.includes(action.capability))
          .map((action) =>
            action.id === 'filesystem.download' && resource.capabilities.includes('browse')
              ? { ...action, label: 'Download as ZIP' }
              : action,
          )
      },
      async run(request): Promise<ResourceActionOutcome> {
        const sourceAddress = filesystemResourceAddress(request.resource.key)
        if (!sourceAddress) {
          return resourceError(new Error('Invalid filesystem resource'), request.resource)
        }
        const descriptor = actionDescriptors.find((item) => item.id === request.actionId)
        if (!descriptor) {
          return resourceError(
            new Error(`Unsupported filesystem action: ${request.actionId}`),
            request.resource,
          )
        }
        if (request.actionId === 'filesystem.upload') {
          const values = inputRecord(request.input)
          const files = Array.isArray(values.files)
            ? values.files.filter((file): file is File => file instanceof File)
            : []
          if (!transport.uploadFiles || files.length === 0) {
            return resourceError(new Error('Upload files are required'), request.resource)
          }
          try {
            return {
              value: await transport.uploadFiles(request.resource.key, files, request.signal),
            }
          } catch (error) {
            return resourceError(error, request.resource)
          }
        }
        let input = request.input
        if (request.actionId === 'filesystem.move' || request.actionId === 'filesystem.copy') {
          const values = inputRecord(request.input)
          if (sourceAddress.rootId === FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID) {
            return badResourceRequest('Application collections are read-only', request.resource)
          }
          const rawDestination = values.destination
          let destination: ResourceKey | null = null
          if (isResourceKey(rawDestination)) {
            destination = rawDestination
          } else if (typeof rawDestination === 'string') {
            try {
              destination = filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, rawDestination)
            } catch {}
          }
          const destinationAddress = destination ? filesystemResourceAddress(destination) : null
          if (!destinationAddress) {
            return badResourceRequest(
              'A filesystem destination resource is required',
              request.resource,
            )
          }
          if (destinationAddress.rootId === FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID) {
            return badResourceRequest(
              'Application collections cannot be move or copy destinations',
              request.resource,
            )
          }
          const typedValues = { ...values }
          delete typedValues.destinationDir
          input = { ...typedValues, destination }
        }
        try {
          const response = await transport.runResourceAction(
            request.resource.key,
            request.actionId,
            input,
            request.signal,
          )
          if (!response.success) {
            return resourceError(new Error('Filesystem action failed'), request.resource)
          }
          return { value: response.data ?? response }
        } catch (error) {
          return resourceError(error, request.resource)
        }
      },
    },
    surface: {
      supports: (instance) =>
        instance.type === 'resource' &&
        (instance.renderer === FILESYSTEM_RENDERER_ID.audio ||
          instance.renderer === FILESYSTEM_RENDERER_ID.video),
      load: async () => {
        const module = await import('./FilesystemResourceViewerContent')
        return module.filesystemContentSurfaceModule
      },
    },
    content: filesystemRendererDescriptors.map((descriptor) => ({
      ...descriptor,
      matchesContent: (instance: ContentInstance) =>
        instance.type === 'resource' &&
        instance.resource.provider === FILESYSTEM_PROVIDER &&
        instance.renderer === descriptor.id,
    })),
    codecs: [filesystemContentCodec()],
    sanitizers: [
      {
        id: 'filesystem.content-sanitizer',
        supports: (instance) =>
          (instance.type === 'explorer' && instance.location.provider === FILESYSTEM_PROVIDER) ||
          (instance.type === 'resource' && instance.resource.provider === FILESYSTEM_PROVIDER),
        sanitize: (instance) => {
          const key =
            instance.type === 'explorer'
              ? instance.location
              : instance.type === 'resource'
                ? instance.resource
                : null
          if (!key || !filesystemResourceAddress(key)) return null
          if (
            instance.type === 'resource' &&
            instance.context &&
            !filesystemResourceAddress(instance.context)
          ) {
            return null
          }
          return instance
        },
      },
    ],
    presentations: [
      {
        id: 'filesystem.presentation',
        describe(instance) {
          if (instance.type === 'explorer') {
            const address = filesystemResourceAddress(instance.location)
            return address
              ? {
                  title: titleFromPath(address.path, 'Library'),
                  category: filesystemContentCategory(instance),
                  icon: 'folder',
                }
              : null
          }
          if (instance.type === 'resource') {
            const address = filesystemResourceAddress(instance.resource)
            return address
              ? {
                  title: titleFromPath(address.path, 'File'),
                  category: filesystemContentCategory(instance),
                  icon: 'file',
                }
              : null
          }
          return null
        },
      },
    ],
    lifecycles: [
      {
        id: 'filesystem.text-lifecycle',
        supports: (instance) =>
          instance.type === 'resource' &&
          instance.resource.provider === FILESYSTEM_PROVIDER &&
          instance.renderer === FILESYSTEM_RENDERER_ID.text,
        canClose: (instance) => canCloseTextViewerContent(instance.id),
      },
    ],
  })
}

export const filesystemIntegrationModule = createFilesystemIntegrationModule()
