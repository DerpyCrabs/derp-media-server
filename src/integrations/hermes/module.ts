import { api, isApiError } from '@/lib/api'
import { apiEndpoints } from '@/lib/api-endpoints'
import {
  isResourceKey,
  resourceKey,
  type ResourceError,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type {
  FileListResponse,
  VirtualEntryDto,
  VirtualOpenTargetDto,
} from '@/lib/generated/api-contracts'
import type { FileItem } from '@/lib/types'
import {
  defineIntegrationModule,
  type ContentDecodeResult,
  type ContentInstance,
  type ResourceActionDescriptor,
  type ResourceActionOutcome,
} from '@/src/features/content/contracts'

export const HERMES_PROVIDER = 'hermes'
export const HERMES_CONTENT_CODEC_ID = 'hermes.content'
export const HERMES_CHAT_RENDERER_ID = 'hermes.chat'

const HERMES_KEY_PREFIX = 'v1:'
const HERMES_LEGACY_ROOT = 'Hermes Sessions'

export type HermesResourceKind = 'root' | 'archived' | 'project' | 'session'

export type HermesResourceAddress = Readonly<{
  kind: HermesResourceKind
  id?: string
}>

export type HermesContentState = Readonly<{
  sessionId?: string
  draftId?: string
  cwd?: string | null
  readOnly?: boolean
  title?: string
  status?: string
}>

export type HermesIntegrationTransport = Readonly<{
  list(path: string, offset: number, signal?: AbortSignal): Promise<FileListResponse>
  runAction(
    action: string,
    path: string,
    input?: unknown,
    signal?: AbortSignal,
  ): Promise<Readonly<{ openTarget?: VirtualOpenTargetDto }> & Record<string, unknown>>
}>

export type HermesIntegrationOptions = Readonly<{
  loadChat?: () => Promise<unknown>
  createDraftId?: () => string
  canClose?: (state: HermesContentState) => boolean | Promise<boolean>
  dispose?: (state: HermesContentState) => void | Promise<void>
}>

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requireOpaqueId(id: string): string {
  if (!id.trim()) throw new Error('Hermes resource id must not be empty')
  if (id.includes('\0')) throw new Error('Hermes resource id must not contain NUL')
  return id
}

export function hermesResourceKey(kind: HermesResourceKind, id?: string): ResourceKey {
  if ((kind === 'project' || kind === 'session') && id === undefined) {
    throw new Error(`Hermes ${kind} resource requires an id`)
  }
  if ((kind === 'root' || kind === 'archived') && id !== undefined) {
    throw new Error(`Hermes ${kind} resource does not accept an id`)
  }
  const opaque = id === undefined ? '' : requireOpaqueId(id)
  return resourceKey(HERMES_PROVIDER, `${HERMES_KEY_PREFIX}${kind.length}:${kind}${opaque}`)
}

export function hermesResourceAddress(key: ResourceKey): HermesResourceAddress | null {
  if (key.provider !== HERMES_PROVIDER || !key.id.startsWith(HERMES_KEY_PREFIX)) return null
  const encoded = key.id.slice(HERMES_KEY_PREFIX.length)
  const separator = encoded.indexOf(':')
  if (separator <= 0) return null
  const kindLengthText = encoded.slice(0, separator)
  if (!/^\d+$/.test(kindLengthText)) return null
  const kindLength = Number(kindLengthText)
  const value = encoded.slice(separator + 1)
  if (!Number.isSafeInteger(kindLength) || kindLength <= 0 || kindLength > value.length) return null
  const kind = value.slice(0, kindLength)
  const id = value.slice(kindLength)
  if (!['root', 'archived', 'project', 'session'].includes(kind)) return null
  if ((kind === 'project' || kind === 'session') && !id) return null
  if ((kind === 'root' || kind === 'archived') && id) return null
  try {
    if (id) requireOpaqueId(id)
  } catch {
    return null
  }
  return id ? { kind: kind as HermesResourceKind, id } : { kind: kind as HermesResourceKind }
}

function legacyPath(address: HermesResourceAddress): string {
  switch (address.kind) {
    case 'root':
      return HERMES_LEGACY_ROOT
    case 'archived':
      return `${HERMES_LEGACY_ROOT}/archived`
    case 'project':
    case 'session':
      return `${HERMES_LEGACY_ROOT}/${address.kind}/${requireOpaqueId(address.id ?? '')}`
  }
}

export function hermesLegacyPathForResourceKey(key: ResourceKey): string | null {
  const address = hermesResourceAddress(key)
  return address ? legacyPath(address) : null
}

function legacyAddress(path: string): HermesResourceAddress | null {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === HERMES_LEGACY_ROOT) return { kind: 'root' }
  if (normalized === `${HERMES_LEGACY_ROOT}/archived`) return { kind: 'archived' }
  const rest = normalized.slice(HERMES_LEGACY_ROOT.length + 1)
  const separator = rest.indexOf('/')
  if (separator <= 0) return null
  const kind = rest.slice(0, separator)
  const id = rest.slice(separator + 1)
  if ((kind !== 'project' && kind !== 'session') || !id) return null
  try {
    return { kind, id: requireOpaqueId(id) }
  } catch {
    return null
  }
}

export function hermesResourceKeyFromLegacyPath(path: string): ResourceKey | null {
  const address = legacyAddress(path)
  return address ? hermesResourceKey(address.kind, address.id) : null
}

function entryAddress(
  file: FileItem,
  entry: VirtualEntryDto | undefined,
): HermesResourceAddress | null {
  if (entry?.kind === 'root') return { kind: 'root' }
  if (entry?.kind === 'archived') return { kind: 'archived' }
  if (entry?.kind === 'project' && entry.id) return { kind: 'project', id: entry.id }
  if (entry?.kind === 'session') {
    const id = entry.openTarget?.sessionId ?? entry.id
    if (id) return { kind: 'session', id }
  }
  return legacyAddress(file.path)
}

export function adaptHermesLegacyEntryResource(
  file: FileItem,
  entry: VirtualEntryDto | undefined,
): ResourceSummary | null {
  const address = entryAddress(file, entry)
  if (!address) return null
  const browse = address.kind !== 'session'
  return {
    key: hermesResourceKey(address.kind, address.id),
    name: file.name,
    kind: `hermes-${address.kind}`,
    capabilities: [
      browse ? 'browse' : 'read',
      ...(entry?.capabilities.map((capability) => `hermes.${capability}`) ?? []),
    ],
    presentation: browse ? 'browse' : 'hermes-session',
    metadata: {
      fileType: file.type,
      extension: file.extension,
      isDirectory: file.isDirectory,
      ...(file.viewCount === undefined ? {} : { viewCount: file.viewCount }),
      ...(file.thumbnailGenerated === undefined
        ? {}
        : { thumbnailGenerated: file.thumbnailGenerated }),
      ...(file.version === undefined ? {} : { version: file.version }),
      ...(entry?.metadata ?? {}),
      ...(entry?.appearance ? { appearance: entry.appearance } : {}),
      ...(entry?.archived === undefined ? {} : { archived: entry.archived }),
    },
  }
}

function errorResult(error: unknown, resource: ResourceSummary): ResourceError {
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
      resource: resource.key,
      retryable: error.status >= 500,
    }
  }
  return {
    schemaVersion: 1,
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
    resource: resource.key,
  }
}

function actionInput(
  input: unknown,
): Readonly<{ name?: string; metadata?: Record<string, unknown> }> {
  const value = record(input)
  return {
    ...(typeof value?.name === 'string' ? { name: value.name } : {}),
    ...(record(value?.metadata) ? { metadata: record(value?.metadata)! } : {}),
  }
}

function normalizedActionInput(input: unknown): unknown {
  const value = record(input)
  if (!value) return input
  if (typeof value.name === 'string' || typeof value.destination !== 'string') return input
  return { ...value, name: value.destination }
}

const HERMES_ACTIONS = [
  ['open', 'Open'],
  ['createFile', 'New session'],
  ['createFolder', 'New project'],
  ['rename', 'Rename'],
  ['archive', 'Archive'],
  ['restore', 'Restore'],
  ['deletePermanently', 'Delete permanently'],
  ['deleteProject', 'Delete project'],
  ['download', 'Download'],
  ['copyId', 'Copy ID'],
  ['branch', 'Branch'],
  ['moveToProject', 'Move to project'],
  ['addProjectFolder', 'Add project folder'],
  ['removeProjectFolder', 'Remove project folder'],
  ['setPrimaryFolder', 'Set primary folder'],
  ['setAppearance', 'Set appearance'],
] as const

function hermesActionInteraction(
  id: (typeof HERMES_ACTIONS)[number][0],
): ResourceActionDescriptor['interaction'] {
  switch (id) {
    case 'createFolder':
    case 'rename':
      return 'name'
    case 'moveToProject':
    case 'addProjectFolder':
    case 'removeProjectFolder':
    case 'setPrimaryFolder':
      return 'destination'
    case 'setAppearance':
      return 'appearance'
    default:
      return 'immediate'
  }
}

const actionDescriptors = HERMES_ACTIONS.map(([id, label]) => ({
  id: `hermes.${id}`,
  label,
  capability: `hermes.${id}`,
  interaction: hermesActionInteraction(id),
  ...(id === 'deletePermanently' || id === 'deleteProject' ? { dangerous: true } : {}),
}))

export function normalizeHermesContentState(value: unknown): HermesContentState | null {
  const state = record(value)
  if (!state) return null
  if (state.sessionId !== undefined && typeof state.sessionId !== 'string') return null
  if (state.draftId !== undefined && typeof state.draftId !== 'string') return null
  if (state.cwd !== undefined && state.cwd !== null && typeof state.cwd !== 'string') return null
  if (state.readOnly !== undefined && typeof state.readOnly !== 'boolean') return null
  if (state.title !== undefined && typeof state.title !== 'string') return null
  if (state.status !== undefined && typeof state.status !== 'string') return null
  if (!state.sessionId && !state.draftId) return null
  return {
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.draftId ? { draftId: state.draftId } : {}),
    ...(state.cwd === null || typeof state.cwd === 'string' ? { cwd: state.cwd } : {}),
    ...(typeof state.readOnly === 'boolean' ? { readOnly: state.readOnly } : {}),
    ...(typeof state.title === 'string' ? { title: state.title } : {}),
    ...(typeof state.status === 'string' ? { status: state.status } : {}),
  }
}

function isHermesContent(instance: ContentInstance): boolean {
  return (
    instance.type === 'integration' &&
    instance.integration === HERMES_PROVIDER &&
    instance.view === 'chat'
  )
}

function isHermesExplorerContent(instance: ContentInstance): boolean {
  if (instance.type !== 'explorer') return false
  const address = hermesResourceAddress(instance.location)
  return address !== null && address.kind !== 'session'
}

function isHermesPersistableContent(instance: ContentInstance): boolean {
  return isHermesContent(instance) || isHermesExplorerContent(instance)
}

function hermesContentCodec() {
  return {
    id: HERMES_CONTENT_CODEC_ID,
    version: 1,
    supports: isHermesPersistableContent,
    encode(instance: ContentInstance) {
      if (isHermesExplorerContent(instance) && instance.type === 'explorer') {
        return {
          kind: 'explorer',
          id: instance.id,
          location: instance.location,
        }
      }
      if (!isHermesContent(instance) || instance.type !== 'integration') {
        throw new Error('Hermes codec only accepts Hermes Explorer or chat content')
      }
      const state = normalizeHermesContentState(instance.state)
      if (!state) throw new Error('Invalid Hermes chat state')
      if (state.draftId && !state.sessionId) throw new Error('Hermes drafts are runtime-only')
      return {
        kind: 'chat',
        id: instance.id,
        sessionId: state.sessionId,
        ...(state.cwd !== undefined ? { cwd: state.cwd } : {}),
        ...(state.readOnly !== undefined ? { readOnly: state.readOnly } : {}),
        ...(state.title ? { title: state.title } : {}),
      }
    },
    decode(value: unknown, encodedVersion?: number): ContentDecodeResult {
      if (encodedVersion !== undefined && encodedVersion !== 1) {
        return {
          ok: false,
          reason: `Unsupported Hermes content version: ${encodedVersion}`,
          recoverable: value,
        }
      }
      const payload = record(value)
      if (
        payload?.kind === 'explorer' &&
        typeof payload.id === 'string' &&
        isResourceKey(payload.location)
      ) {
        const address = hermesResourceAddress(payload.location)
        if (address && address.kind !== 'session') {
          return {
            ok: true,
            instance: {
              id: payload.id,
              type: 'explorer',
              location: payload.location,
            },
          }
        }
      }
      if (
        payload?.kind === 'chat' &&
        typeof payload.id === 'string' &&
        typeof payload.sessionId === 'string'
      ) {
        const state = normalizeHermesContentState({
          sessionId: payload.sessionId,
          cwd: payload.cwd,
          readOnly: payload.readOnly,
          title: payload.title,
        })
        if (state) {
          return {
            ok: true,
            instance: {
              id: payload.id,
              type: 'integration',
              integration: HERMES_PROVIDER,
              view: 'chat',
              state,
            },
          }
        }
      }
      return { ok: false, reason: 'Invalid Hermes content', recoverable: value }
    },
  } as const
}

function titleForResource(address: HermesResourceAddress, fallback: string): string {
  switch (address.kind) {
    case 'root':
      return 'Hermes Sessions'
    case 'archived':
      return 'Archived'
    default:
      return fallback
  }
}

function hermesLocationSummary(
  address: HermesResourceAddress,
  capabilities: readonly string[] = [],
): ResourceSummary {
  return {
    key: hermesResourceKey(address.kind, address.id),
    name: titleForResource(address, address.id ?? 'Hermes'),
    kind: `hermes-${address.kind}`,
    capabilities: ['browse', ...capabilities],
    presentation: 'browse',
  }
}

function hermesBreadcrumbs(address: HermesResourceAddress): ResourceSummary[] {
  const root = hermesLocationSummary({ kind: 'root' })
  return address.kind === 'root' ? [root] : [root, hermesLocationSummary(address)]
}

export const defaultHermesIntegrationTransport: HermesIntegrationTransport = {
  list: (path, offset, signal) => apiEndpoints.files.list({ dir: path, offset }, signal),
  runAction: (action, path, input, signal) =>
    api('/api/virtual-directory/action', {
      method: 'POST',
      signal,
      body: JSON.stringify({ action, path, ...actionInput(input) }),
    }),
}

export function createHermesIntegrationModule(
  transport: HermesIntegrationTransport = defaultHermesIntegrationTransport,
  options: HermesIntegrationOptions = {},
) {
  const createDraftId = options.createDraftId ?? (() => crypto.randomUUID())
  return defineIntegrationModule({
    id: HERMES_PROVIDER,
    browse: {
      async browse(request) {
        const address = hermesResourceAddress(request.location)
        if (!address || address.kind === 'session')
          throw new Error('Invalid Hermes browse location')
        const offset = Number(request.cursor ?? 0)
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid browse cursor')
        const listing = await transport.list(legacyPath(address), offset, request.signal)
        const entries = listing.virtualEntries ?? {}
        const items = listing.files
          .map((file) => adaptHermesLegacyEntryResource(file, entries[file.path]))
          .filter((resource): resource is ResourceSummary => resource !== null)
        const nextOffset = listing.virtualDirectory?.nextOffset
        const locationCapabilities =
          listing.virtualDirectory?.capabilities.map((capability) => `hermes.${capability}`) ?? []
        return {
          schemaVersion: 1,
          location: request.location,
          locationSummary: hermesLocationSummary(address, locationCapabilities),
          breadcrumbs: hermesBreadcrumbs(address),
          items,
          ...(nextOffset === undefined ? {} : { nextCursor: String(nextOffset) }),
          total: Math.max(listing.virtualDirectory?.total ?? items.length, items.length),
        }
      },
    },
    actions: {
      list(resource) {
        return actionDescriptors.filter((action) =>
          resource.capabilities.includes(action.capability),
        )
      },
      async run(request): Promise<ResourceActionOutcome> {
        const address = hermesResourceAddress(request.resource.key)
        if (!address) return errorResult(new Error('Invalid Hermes resource'), request.resource)
        const descriptor = actionDescriptors.find((item) => item.id === request.actionId)
        if (!descriptor) {
          return errorResult(
            new Error(`Unsupported Hermes action: ${request.actionId}`),
            request.resource,
          )
        }
        const action = descriptor.id.slice('hermes.'.length)
        if (action === 'copyId') return { value: { text: address.id ?? '' } }
        if (action === 'download') {
          return {
            value: {
              url: `/api/virtual-directory/export?path=${encodeURIComponent(legacyPath(address))}`,
            },
          }
        }
        try {
          const response = await transport.runAction(
            action,
            legacyPath(address),
            normalizedActionInput(request.input),
            request.signal,
          )
          const target = response.openTarget
          if (!target) return { value: response }
          if (target.type === 'hermesSession' && target.sessionId) {
            return {
              content: {
                id: `hermes-${target.sessionId}`,
                type: 'integration',
                integration: HERMES_PROVIDER,
                view: 'chat',
                state: {
                  sessionId: target.sessionId,
                  readOnly: target.readOnly,
                } satisfies HermesContentState,
              },
            }
          }
          const draftId = createDraftId()
          return {
            content: {
              id: `hermes-draft-${draftId}`,
              type: 'integration',
              integration: HERMES_PROVIDER,
              view: 'chat',
              state: {
                draftId,
                cwd: target.projectPath,
                readOnly: target.readOnly,
              } satisfies HermesContentState,
            },
          }
        } catch (error) {
          return errorResult(error, request.resource)
        }
      },
    },
    content: [
      {
        id: HERMES_CHAT_RENDERER_ID,
        rules: [
          { type: 'kind', value: 'hermes-session', intents: ['default', 'view'] },
          { type: 'presentation', value: 'hermes-session', intents: ['default', 'view'] },
        ],
        requiresAnyCapability: ['read'],
        matchesContent: isHermesContent,
        load: async () => {
          const [loaded, adapter] = await Promise.all([
            (options.loadChat ?? (() => import('./HermesChatPane')))(),
            import('./renderer'),
          ])
          return adapter.createHermesChatRendererModule(loaded)
        },
      },
    ],
    codecs: [hermesContentCodec()],
    sanitizers: [
      {
        id: 'hermes.content-sanitizer',
        supports: isHermesContent,
        sanitize(instance) {
          return instance.type === 'integration' && normalizeHermesContentState(instance.state)
            ? instance
            : null
        },
      },
    ],
    presentations: [
      {
        id: 'hermes.presentation',
        describe(instance) {
          if (instance.type === 'integration' && isHermesContent(instance)) {
            const state = normalizeHermesContentState(instance.state)
            if (!state) return null
            return {
              title:
                state.title?.trim() || (state.sessionId ? 'Hermes session' : 'New Hermes session'),
              icon: 'agent-session',
              ...(state.cwd ? { subtitle: state.cwd } : {}),
              ...(state.readOnly
                ? { status: { label: 'Read only', tone: 'violet' } }
                : state.status
                  ? { status: { label: state.status, tone: 'violet' } }
                  : {}),
              preferredSize: { width: 720, height: 640 },
            }
          }
          const key =
            instance.type === 'explorer'
              ? instance.location
              : instance.type === 'resource'
                ? instance.resource
                : null
          if (!key || !isResourceKey(key)) return null
          const address = hermesResourceAddress(key)
          return address
            ? {
                title: titleForResource(address, address.id ?? 'Hermes'),
                icon: address.kind === 'project' ? 'project' : 'agent-session',
              }
            : null
        },
      },
    ],
    lifecycles: [
      {
        id: 'hermes.chat-lifecycle',
        supports: isHermesContent,
        async canClose(instance) {
          if (instance.type !== 'integration') return true
          const state = normalizeHermesContentState(instance.state)
          if (!state) return true
          if (options.canClose) return options.canClose(state)
          const store = await import('@/lib/hermes-session-store')
          return store.canCloseHermesWindow(state)
        },
        async dispose(instance) {
          if (instance.type !== 'integration') return
          const state = normalizeHermesContentState(instance.state)
          if (!state) return
          if (options.dispose) return options.dispose(state)
          const store = await import('@/lib/hermes-session-store')
          store.discardHermesDraft(state)
        },
      },
    ],
  })
}

export const hermesIntegrationModule = createHermesIntegrationModule()
