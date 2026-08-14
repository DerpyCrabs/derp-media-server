import { isApiError } from '@/lib/api'
import { isResourceKey, type ResourceError, type ResourceSummary } from '@/lib/domain/resource'
import {
  defineIntegrationModule,
  type ContentDecodeResult,
  type ContentInstance,
  type ResourceActionDescriptor,
  type ResourceActionOutcome,
} from '@/src/features/content/contracts'
import { hermesAssistantProvider } from './assistant'
import {
  browseIntegrationResource,
  inspectIntegrationResource,
  runIntegrationAction,
} from '@/src/integrations/http-client'
import {
  HERMES_PROVIDER,
  hermesResourceAddress,
  hermesResourceKey,
  type HermesResourceAddress,
  type HermesResourceKind,
} from './resource-key'
import { deletedHermesSessionIds, hermesSessionLiveStatus } from './runtime-state'

export { HERMES_PROVIDER, hermesResourceAddress, hermesResourceKey }
export type { HermesResourceAddress, HermesResourceKind }
export const HERMES_CONTENT_CODEC_ID = 'hermes.content'
export const HERMES_CHAT_RENDERER_ID = 'hermes.chat'

export type HermesContentState = Readonly<{
  sessionId?: string
  draftId?: string
  cwd?: string | null
  readOnly?: boolean
  title?: string
  status?: string
}>

export type HermesIntegrationTransport = Readonly<{
  browseResource: typeof browseIntegrationResource
  inspectResource: typeof inspectIntegrationResource
  runResourceAction: typeof runIntegrationAction
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

function normalizedActionInput(input: unknown): unknown {
  const value = record(input)
  if (!value) return input
  if (typeof value.name === 'string' || typeof value.destination !== 'string') return input
  return { ...value, name: value.destination }
}

const HERMES_ACTIONS = [
  ['open', 'Open'],
  ['createFile', 'Create new session'],
  ['createFolder', 'Create new project'],
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
      return 'destination'
    case 'addProjectFolder':
    case 'removeProjectFolder':
    case 'setPrimaryFolder':
      return 'text'
    case 'setAppearance':
      return 'appearance'
    default:
      return 'immediate'
  }
}

const actionDescriptors = HERMES_ACTIONS.map(([id, label]) => ({
  id: `hermes.${id}`,
  operation: id,
  label,
  capability: `hermes.${id}`,
  interaction: hermesActionInteraction(id),
  ...(id === 'rename'
    ? { optimisticEffect: 'rename' as const }
    : id === 'deletePermanently' || id === 'deleteProject'
      ? { optimisticEffect: 'delete' as const }
      : {}),
  ...(id === 'deletePermanently' || id === 'deleteProject' ? { dangerous: true } : {}),
}))

const HERMES_PROJECT_CHOICES_METADATA = 'hermesProjectChoices'

function projectChoices(resource: ResourceSummary) {
  const choices = resource.metadata?.[HERMES_PROJECT_CHOICES_METADATA]
  if (!Array.isArray(choices)) return []
  return choices.flatMap((choice) => {
    const value = record(choice)
    return typeof value?.label === 'string' && typeof value.value === 'string'
      ? [{ label: value.label, value: value.value }]
      : []
  })
}

function actionForm(
  action: (typeof actionDescriptors)[number],
  resource: ResourceSummary,
): ResourceActionDescriptor['form'] | undefined {
  if (action.operation === 'createFolder') {
    return { kind: 'project', title: 'Create Hermes project', submitLabel: 'Create' }
  }
  if (action.operation === 'moveToProject') {
    return {
      kind: 'choice',
      title: 'Move to Hermes project',
      submitLabel: 'Move',
      choices: projectChoices(resource),
    }
  }
  if (action.operation === 'setAppearance') {
    return {
      kind: 'appearance',
      title: 'Project appearance',
      submitLabel: 'Save',
      icons: ['Folder', 'Star', 'Archive', 'Bot', 'MessageSquare'],
    }
  }
  return undefined
}

function withHermesProjectChoices<T extends ResourceSummary>(resource: T, choices: unknown[]): T {
  return {
    ...resource,
    metadata: { ...resource.metadata, [HERMES_PROJECT_CHOICES_METADATA]: choices },
  }
}

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

function isHermesSessionResource(instance: ContentInstance): boolean {
  if (instance.type !== 'resource' || instance.renderer !== HERMES_CHAT_RENDERER_ID) return false
  const address = hermesResourceAddress(instance.resource)
  return address?.kind === 'session'
}

function isHermesExplorerContent(instance: ContentInstance): boolean {
  if (instance.type !== 'explorer') return false
  const address = hermesResourceAddress(instance.location)
  return address !== null && address.kind !== 'session'
}

function isHermesPersistableContent(instance: ContentInstance): boolean {
  return (
    isHermesContent(instance) ||
    isHermesSessionResource(instance) ||
    isHermesExplorerContent(instance)
  )
}

function hermesContentCodec() {
  return {
    id: HERMES_CONTENT_CODEC_ID,
    version: 1,
    supports: isHermesPersistableContent,
    durable(instance: ContentInstance) {
      if (!isHermesContent(instance) || instance.type !== 'integration') return true
      const state = normalizeHermesContentState(instance.state)
      return !!state?.sessionId && !deletedHermesSessionIds.has(state.sessionId)
    },
    preserveRuntime(instance: ContentInstance) {
      if (!isHermesContent(instance) || instance.type !== 'integration') return false
      const state = normalizeHermesContentState(instance.state)
      return !!state?.draftId && !state.sessionId
    },
    encode(instance: ContentInstance) {
      if (isHermesExplorerContent(instance) && instance.type === 'explorer') {
        return {
          kind: 'explorer',
          id: instance.id,
          location: instance.location,
        }
      }
      if (isHermesSessionResource(instance) && instance.type === 'resource') {
        return {
          kind: 'resource',
          id: instance.id,
          resource: instance.resource,
          renderer: instance.renderer,
        }
      }
      if (!isHermesContent(instance) || instance.type !== 'integration') {
        throw new Error('Hermes codec only accepts Hermes Explorer or session content')
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
    decode(value: unknown, encodedVersion: number): ContentDecodeResult {
      if (encodedVersion !== 1) {
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
        payload?.kind === 'resource' &&
        typeof payload.id === 'string' &&
        isResourceKey(payload.resource) &&
        payload.renderer === HERMES_CHAT_RENDERER_ID
      ) {
        const address = hermesResourceAddress(payload.resource)
        if (address?.kind === 'session') {
          return {
            ok: true,
            instance: {
              id: payload.id,
              type: 'resource',
              resource: payload.resource,
              renderer: HERMES_CHAT_RENDERER_ID,
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

export const defaultHermesIntegrationTransport: HermesIntegrationTransport = {
  browseResource: browseIntegrationResource,
  inspectResource: inspectIntegrationResource,
  runResourceAction: runIntegrationAction,
}

export function createHermesIntegrationModule(
  transport: HermesIntegrationTransport = defaultHermesIntegrationTransport,
  options: HermesIntegrationOptions = {},
) {
  const createDraftId = options.createDraftId ?? (() => crypto.randomUUID())
  return defineIntegrationModule({
    id: HERMES_PROVIDER,
    name: 'Hermes',
    root: hermesLocationSummary({ kind: 'root' }),
    assistant: hermesAssistantProvider,
    panes: [
      {
        id: 'hermes.assistant',
        kind: 'assistant',
        label: 'Assistant',
        create(instanceId) {
          return {
            id: instanceId,
            type: 'integration',
            integration: HERMES_PROVIDER,
            view: 'chat',
            state: {
              draftId: createDraftId(),
              readOnly: false,
            } satisfies HermesContentState,
          }
        },
      },
    ],
    browse: {
      async browse(request) {
        const page = await transport.browseResource(request)
        const choices = page.items
          .filter((resource) => resource.capabilities.includes('hermes.addProjectFolder'))
          .map((resource) => ({ label: resource.name, value: resource.name }))
        const decorate = (resource: ResourceSummary) => withHermesProjectChoices(resource, choices)
        return {
          ...page,
          ...(page.locationSummary ? { locationSummary: decorate(page.locationSummary) } : {}),
          breadcrumbs: page.breadcrumbs?.map(decorate),
          items: page.items.map(decorate),
        }
      },
    },
    inspect: { inspect: transport.inspectResource },
    actions: {
      list(resource) {
        return actionDescriptors
          .filter((action) => resource.capabilities.includes(action.capability))
          .map((action) => {
            const form = actionForm(action, resource)
            return form ? { ...action, form } : action
          })
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
        if (descriptor.id === 'hermes.copyId') return { value: { text: address.id ?? '' } }
        try {
          const response = await transport.runResourceAction(
            request.resource.key,
            request.actionId,
            normalizedActionInput(request.input),
            request.signal,
          )
          if (!response.success) {
            return errorResult(new Error('Hermes action failed'), request.resource)
          }
          const target = response.openTarget
          if (!target) return { value: response.data ?? response }
          if (target.kind === 'hermes-session' && target.resource) {
            const targetAddress = hermesResourceAddress(target.resource)
            if (targetAddress?.kind === 'session') {
              return {
                content: {
                  id: `hermes-${targetAddress.id}`,
                  type: 'integration',
                  integration: HERMES_PROVIDER,
                  view: 'chat',
                  state: {
                    sessionId: targetAddress.id,
                    readOnly: target.readOnly,
                  } satisfies HermesContentState,
                },
              }
            }
          }
          if (target.kind === 'hermes-draft') {
            const payload = record(target.payload)
            const draftId = createDraftId()
            return {
              content: {
                id: `hermes-draft-${draftId}`,
                type: 'integration',
                integration: HERMES_PROVIDER,
                view: 'chat',
                state: {
                  draftId,
                  cwd: typeof payload?.projectPath === 'string' ? payload.projectPath : null,
                  readOnly: target.readOnly,
                } satisfies HermesContentState,
              },
            }
          }
          return { value: response.data ?? response }
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
        matchesContent: (instance) =>
          isHermesContent(instance) || isHermesSessionResource(instance),
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
        supports: (instance) => isHermesContent(instance) || isHermesSessionResource(instance),
        sanitize(instance) {
          if (isHermesSessionResource(instance)) return instance
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
    status: {
      describe(instance) {
        if (!isHermesContent(instance) || instance.type !== 'integration') return null
        const sessionId = normalizeHermesContentState(instance.state)?.sessionId
        return sessionId ? hermesSessionLiveStatus(sessionId) : null
      },
    },
    lifecycles: [
      {
        id: 'hermes.chat-lifecycle',
        supports: (instance) => isHermesContent(instance) || isHermesSessionResource(instance),
        async canClose(instance) {
          if (instance.type === 'resource') return true
          if (instance.type !== 'integration') return true
          const state = normalizeHermesContentState(instance.state)
          if (!state) return true
          if (options.canClose) return options.canClose(state)
          const store = await import('./session-store')
          return store.canCloseHermesWindow(state)
        },
        async dispose(instance) {
          if (instance.type === 'resource') return
          if (instance.type !== 'integration') return
          const state = normalizeHermesContentState(instance.state)
          if (!state) return
          if (options.dispose) return options.dispose(state)
          const store = await import('./session-store')
          store.discardHermesDraft(state)
        },
      },
    ],
  })
}

export const hermesIntegrationModule = createHermesIntegrationModule()
