import type { IntegrationContentInstance, ResourceContentInstance } from '@/lib/domain/content'
import type {
  ContentRendererModule,
  ContentRendererMountContext,
} from '@/src/features/open/renderer-registry'
import { createComponent, type JSX } from 'solid-js'
import type { HermesChatPaneProps } from './HermesChatPane'
import {
  HERMES_PROVIDER,
  hermesResourceAddress,
  normalizeHermesContentState,
  type HermesContentState,
} from './module'

type HermesChatComponent = (props: HermesChatPaneProps) => JSX.Element

function chatComponent(value: unknown): HermesChatComponent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const component = (value as Record<string, unknown>).HermesChatPane
  return typeof component === 'function' ? (component as HermesChatComponent) : null
}

function chatInstance(
  context: ContentRendererMountContext,
): IntegrationContentInstance | ResourceContentInstance {
  const instance = context.instance()
  if (instance.type === 'resource' && instance.renderer === 'hermes.chat') {
    const address = hermesResourceAddress(instance.resource)
    if (address?.kind === 'session') return instance
  }
  if (
    instance.type === 'integration' &&
    instance.integration === HERMES_PROVIDER &&
    instance.view === 'chat'
  )
    return instance
  throw new Error('Hermes renderer requires Hermes chat content')
}

function chatState(context: ContentRendererMountContext): HermesContentState {
  const instance = chatInstance(context)
  const state =
    instance.type === 'resource'
      ? (() => {
          const address = hermesResourceAddress(instance.resource)
          return address?.kind === 'session' ? { sessionId: address.id } : null
        })()
      : normalizeHermesContentState(instance.state)
  if (!state) throw new Error('Hermes renderer received invalid chat state')
  return state
}

function replaceState(
  context: ContentRendererMountContext,
  update: (state: HermesContentState) => HermesContentState,
) {
  const instance = chatInstance(context)
  const state = update(chatState(context))
  context.replace(
    instance.type === 'integration'
      ? { ...instance, state }
      : ({
          id: instance.id,
          type: 'integration',
          integration: HERMES_PROVIDER,
          view: 'chat',
          state,
        } satisfies IntegrationContentInstance),
  )
}

export function createHermesChatRendererModule(value: unknown): ContentRendererModule {
  const Content = chatComponent(value)
  if (!Content) throw new Error('Hermes chat renderer module is invalid')
  return {
    kind: 'content',
    mount: (context) =>
      createComponent(Content, {
        instanceId: () => chatInstance(context).id,
        content: () => chatState(context),
        title: () => chatState(context).title,
        contentVisible: context.active,
        active: context.active,
        onSessionCreated: (sessionId) =>
          replaceState(context, (state) => {
            const { draftId: _draftId, ...durable } = state
            return {
              ...durable,
              sessionId,
              ...(state.title === 'New Hermes session' ? { title: 'Hermes session' } : {}),
            }
          }),
        onTitleChanged: (title) => replaceState(context, (state) => ({ ...state, title })),
        onBranchCreated: (sessionId, title) =>
          context.open?.({
            id: `hermes-${sessionId}`,
            type: 'integration',
            integration: HERMES_PROVIDER,
            view: 'chat',
            state: { sessionId, title } satisfies HermesContentState,
          }),
      }),
  }
}
