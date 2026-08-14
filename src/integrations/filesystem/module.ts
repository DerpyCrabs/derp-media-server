import { apiEndpoints } from '@/lib/api-endpoints'
import { isApiError } from '@/lib/api'
import { adaptFileItemResource, LEGACY_FILESYSTEM_ROOT_ID } from '@/lib/domain/file-item-resource'
import {
  FILESYSTEM_PROVIDER,
  filesystemResourceAddress,
  filesystemResourceKey,
  type ResourceError,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type { FileListResponse, VirtualEntryDto } from '@/lib/generated/api-contracts'
import type { FileItem } from '@/lib/types'
import {
  defineIntegrationModule,
  isContentInstance,
  type ContentDecodeResult,
  type ContentInstance,
  type ResourceActionOutcome,
} from '@/src/features/content/contracts'
import {
  BUILT_IN_RENDERER_ID,
  builtInRendererDescriptors,
} from '@/src/features/open/renderer-registry'
import { filesystemRendererLoader } from './renderers'
import { canCloseTextViewerContent } from '@/src/features/viewer/text-viewer-lifecycle'

export const FILESYSTEM_CONTENT_CODEC_ID = 'filesystem.content'

export function legacyFilesystemResourceKey(path: string, rootId = LEGACY_FILESYSTEM_ROOT_ID) {
  return filesystemResourceKey(rootId, path)
}

export function filesystemLegacyPathForResourceKey(key: ResourceSummary['key']): string | null {
  return filesystemResourceAddress(key)?.path ?? null
}

export type FilesystemIntegrationTransport = Readonly<{
  list(path: string, offset: number, signal?: AbortSignal): Promise<FileListResponse>
  runAction(action: string, path: string, input?: unknown, signal?: AbortSignal): Promise<unknown>
  downloadUrl(path: string): string
}>

export type FilesystemIntegrationOptions = Readonly<{
  adaptVirtual?: (file: FileItem, entry: VirtualEntryDto | undefined) => ResourceSummary | null
}>

const actionDescriptors = [
  {
    id: 'filesystem.createFile',
    label: 'Create new file',
    capability: 'filesystem.create',
    interaction: 'name',
  },
  {
    id: 'filesystem.createFolder',
    label: 'Create new folder',
    capability: 'filesystem.create',
    interaction: 'name',
  },
  {
    id: 'filesystem.upload',
    label: 'Upload',
    capability: 'filesystem.upload',
    interaction: 'upload',
  },
  {
    id: 'filesystem.paste',
    label: 'Paste',
    capability: 'filesystem.paste',
    interaction: 'paste',
  },
  {
    id: 'filesystem.rename',
    label: 'Rename',
    capability: 'filesystem.rename',
    interaction: 'name',
  },
  {
    id: 'filesystem.move',
    label: 'Move to...',
    capability: 'filesystem.move',
    interaction: 'destination',
  },
  {
    id: 'filesystem.copy',
    label: 'Copy to...',
    capability: 'filesystem.copy',
    interaction: 'destination',
  },
  {
    id: 'filesystem.delete',
    label: 'Delete',
    capability: 'filesystem.delete',
    dangerous: true,
    interaction: 'immediate',
  },
  {
    id: 'filesystem.download',
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

function filesystemCapabilities(file: FileItem): string[] {
  const base = adaptFileItemResource(file).resource.capabilities
  return [
    ...base,
    'filesystem.rename',
    'filesystem.move',
    'filesystem.copy',
    'filesystem.delete',
    ...(file.isDirectory ? ['filesystem.create', 'filesystem.upload', 'filesystem.paste'] : []),
  ]
}

function adaptFile(file: FileItem, rootId: string): ResourceSummary {
  const resource = adaptFileItemResource(file, {
    rootId,
    logicalPath: file.path,
    capabilities: filesystemCapabilities(file),
  }).resource
  return {
    ...resource,
    metadata: {
      fileType: file.type,
      extension: file.extension,
      isDirectory: file.isDirectory,
      ...(file.viewCount === undefined ? {} : { viewCount: file.viewCount }),
      ...(file.thumbnailGenerated === undefined
        ? {}
        : { thumbnailGenerated: file.thumbnailGenerated }),
      ...(file.version === undefined ? {} : { version: file.version }),
    },
  }
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

function inputRecord(input: unknown): Record<string, unknown> {
  return record(input) ?? {}
}

async function runDefaultFilesystemAction(
  action: string,
  path: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const values = inputRecord(input)
  switch (action) {
    case 'create': {
      const name = values.name
      const targetPath =
        typeof values.path === 'string'
          ? values.path
          : typeof name === 'string' && name.trim()
            ? [path, name].filter(Boolean).join('/')
            : null
      if (!targetPath) throw new Error('path or name is required')
      return apiEndpoints.files.create(
        {
          type: values.type === 'folder' ? 'folder' : 'file',
          path: targetPath,
          ...(typeof values.content === 'string' ? { content: values.content } : {}),
          ...(typeof values.base64Content === 'string'
            ? { base64Content: values.base64Content }
            : {}),
        },
        signal,
      )
    }
    case 'upload': {
      const body = input instanceof FormData ? input : values.formData
      if (!(body instanceof FormData)) throw new Error('formData is required')
      return apiEndpoints.files.upload(body, signal)
    }
    case 'paste': {
      const targetPath = typeof values.path === 'string' ? values.path : null
      if (!targetPath) throw new Error('path is required')
      const body = {
        path: targetPath,
        ...(typeof values.content === 'string' ? { content: values.content } : {}),
        ...(typeof values.base64Content === 'string'
          ? { base64Content: values.base64Content }
          : {}),
      }
      return values.mode === 'replace'
        ? apiEndpoints.files.edit(
            {
              ...body,
              ...(typeof values.expectedVersion === 'number'
                ? { expectedVersion: values.expectedVersion }
                : {}),
            },
            signal,
          )
        : apiEndpoints.files.create({ type: 'file', ...body }, signal)
    }
    case 'rename': {
      const newPath = values.newPath
      if (typeof newPath !== 'string' || !newPath.trim()) throw new Error('newPath is required')
      return apiEndpoints.files.rename({ oldPath: path, newPath }, signal)
    }
    case 'copy': {
      const destinationDir = values.destinationDir
      if (typeof destinationDir !== 'string') throw new Error('destinationDir is required')
      return apiEndpoints.files.copy({ sourcePath: path, destinationDir }, signal)
    }
    case 'delete':
      return apiEndpoints.files.delete({ path }, signal)
    default:
      throw new Error(`Unsupported filesystem action: ${action}`)
  }
}

export const defaultFilesystemIntegrationTransport: FilesystemIntegrationTransport = {
  list: (path, offset, signal) => apiEndpoints.files.list({ dir: path, offset }, signal),
  runAction: (action, path, input, signal) =>
    runDefaultFilesystemAction(action, path, input, signal),
  downloadUrl: apiEndpoints.files.downloadUrl,
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
    decode(value: unknown, encodedVersion?: number): ContentDecodeResult {
      if (encodedVersion !== undefined && encodedVersion !== 1) {
        return {
          ok: false,
          reason: `Unsupported filesystem content version: ${encodedVersion}`,
          recoverable: value,
        }
      }
      if (isContentInstance(value)) {
        return this.supports(value)
          ? { ok: true, instance: value }
          : { ok: false, reason: 'Content is not filesystem-owned', recoverable: value }
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
                location: filesystemResourceKey(address.rootId, address.path),
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
                resource: filesystemResourceKey(address.rootId, address.path),
                renderer: payload.renderer,
                ...(typeof contextAddress?.rootId === 'string' &&
                typeof contextAddress.path === 'string'
                  ? {
                      context: filesystemResourceKey(contextAddress.rootId, contextAddress.path),
                    }
                  : {}),
              },
            }
          } catch {}
        }
      }

      const initialState = record(payload?.initialState)
      if (typeof payload?.id === 'string' && payload.type === 'browser') {
        const path = typeof initialState?.dir === 'string' ? initialState.dir : ''
        return {
          ok: true,
          instance: {
            id: payload.id,
            type: 'explorer',
            location: filesystemResourceKey(LEGACY_FILESYSTEM_ROOT_ID, path),
          },
        }
      }
      if (typeof payload?.id === 'string' && payload.type === 'viewer') {
        const path =
          typeof initialState?.viewing === 'string'
            ? initialState.viewing
            : typeof payload.iconPath === 'string'
              ? payload.iconPath
              : null
        if (path) {
          const renderer =
            initialState?.readerKind === 'folder'
              ? BUILT_IN_RENDERER_ID.folderReader
              : initialState?.readerKind === 'book'
                ? BUILT_IN_RENDERER_ID.book
                : initialState?.readerKind === 'pdf'
                  ? BUILT_IN_RENDERER_ID.pdf
                  : typeof payload.iconType === 'string'
                    ? ((
                        {
                          video: BUILT_IN_RENDERER_ID.video,
                          audio: BUILT_IN_RENDERER_ID.audio,
                          image: BUILT_IN_RENDERER_ID.image,
                          text: BUILT_IN_RENDERER_ID.text,
                          pdf: BUILT_IN_RENDERER_ID.pdf,
                          book: BUILT_IN_RENDERER_ID.book,
                        } as Record<string, string>
                      )[payload.iconType] ?? BUILT_IN_RENDERER_ID.unsupported)
                    : BUILT_IN_RENDERER_ID.unsupported
          return {
            ok: true,
            instance: {
              id: payload.id,
              type: 'resource',
              resource: filesystemResourceKey(LEGACY_FILESYSTEM_ROOT_ID, path),
              renderer,
              ...(typeof initialState?.dir === 'string'
                ? {
                    context: filesystemResourceKey(LEGACY_FILESYSTEM_ROOT_ID, initialState.dir),
                  }
                : {}),
            },
          }
        }
      }
      return { ok: false, reason: 'Invalid filesystem content', recoverable: value }
    },
  } as const
}

function titleFromPath(path: string, fallback: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? fallback
}

function filesystemLocationSummary(rootId: string, path: string): ResourceSummary {
  return {
    key: filesystemResourceKey(rootId, path),
    name: titleFromPath(path, 'Library'),
    kind: path ? 'folder' : 'root',
    capabilities: ['browse', 'filesystem.create', 'filesystem.upload', 'filesystem.paste'],
    presentation: 'browse',
  }
}

function filesystemBreadcrumbs(rootId: string, path: string): ResourceSummary[] {
  const breadcrumbs = [filesystemLocationSummary(rootId, '')]
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  for (let index = 0; index < parts.length; index += 1) {
    breadcrumbs.push(filesystemLocationSummary(rootId, parts.slice(0, index + 1).join('/')))
  }
  return breadcrumbs
}

export function createFilesystemIntegrationModule(
  transport: FilesystemIntegrationTransport = defaultFilesystemIntegrationTransport,
  options: FilesystemIntegrationOptions = {},
) {
  return defineIntegrationModule({
    id: FILESYSTEM_PROVIDER,
    browse: {
      async browse(request) {
        const address = filesystemResourceAddress(request.location)
        if (!address) throw new Error('Invalid filesystem browse location')
        const offset = Number(request.cursor ?? 0)
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid browse cursor')
        const listing = await transport.list(address.path, offset, request.signal)
        const entries = listing.virtualEntries ?? {}
        const items = listing.files.flatMap((file) => {
          if (!file.isVirtual) return [adaptFile(file, address.rootId)]
          const adapted = options.adaptVirtual?.(file, entries[file.path])
          return adapted ? [adapted] : []
        })
        return {
          schemaVersion: 1,
          location: request.location,
          locationSummary: filesystemLocationSummary(address.rootId, address.path),
          breadcrumbs: filesystemBreadcrumbs(address.rootId, address.path),
          items,
          total: items.length,
        }
      },
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
        const address = filesystemResourceAddress(request.resource.key)
        if (!address)
          return resourceError(new Error('Invalid filesystem resource'), request.resource)
        let action = request.actionId.replace(/^filesystem\./, '')
        let input = request.input
        if (action === 'createFile' || action === 'createFolder') {
          input = {
            ...inputRecord(request.input),
            type: action === 'createFolder' ? 'folder' : 'file',
          }
          action = 'create'
        }
        if (action === 'rename') {
          const values = inputRecord(request.input)
          if (typeof values.newPath !== 'string' && typeof values.name === 'string') {
            const parent = address.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
            input = {
              ...values,
              newPath: [parent, values.name].filter(Boolean).join('/'),
            }
          }
        }
        if (action === 'move') {
          const values = inputRecord(request.input)
          const destinationDir =
            typeof values.destinationDir === 'string' ? values.destinationDir : values.destination
          if (typeof destinationDir !== 'string') {
            return resourceError(new Error('destinationDir is required'), request.resource)
          }
          const name = address.path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? ''
          input = {
            ...values,
            destinationDir,
            newPath: [destinationDir, name].filter(Boolean).join('/'),
          }
          action = 'rename'
        }
        if (action === 'copy') {
          const values = inputRecord(request.input)
          const destinationDir =
            typeof values.destinationDir === 'string' ? values.destinationDir : values.destination
          if (typeof destinationDir !== 'string') {
            return resourceError(new Error('destinationDir is required'), request.resource)
          }
          input = { ...values, destinationDir }
        }
        if (action === 'download') {
          return {
            value: {
              url: transport.downloadUrl(address.path),
              filename: request.resource.capabilities.includes('browse')
                ? `${request.resource.name}.zip`
                : request.resource.name,
            },
          }
        }
        try {
          return {
            value: await transport.runAction(action, address.path, input, request.signal),
          }
        } catch (error) {
          return resourceError(error, request.resource)
        }
      },
    },
    content: builtInRendererDescriptors.map((descriptor) => ({
      ...descriptor,
      load: filesystemRendererLoader(descriptor.id) ?? descriptor.load,
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
              ? { title: titleFromPath(address.path, 'Library'), icon: 'folder' }
              : null
          }
          if (instance.type === 'resource') {
            const address = filesystemResourceAddress(instance.resource)
            return address ? { title: titleFromPath(address.path, 'File'), icon: 'file' } : null
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
          instance.renderer === BUILT_IN_RENDERER_ID.text,
        canClose: (instance) => canCloseTextViewerContent(instance.id),
      },
    ],
  })
}

export const filesystemIntegrationModule = createFilesystemIntegrationModule()
