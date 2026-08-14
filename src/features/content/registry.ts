import {
  CONTENT_ENVELOPE_SCHEMA_VERSION,
  isContentInstance,
  isPersistedContentEnvelope,
  type ContentInstance,
  type PersistedContentEnvelope,
} from '@/lib/domain/content'
import type { ResourceKey, ResourceSummary } from '@/lib/domain/resource'
import type { PlaybackItem, PlaybackSourceRequest, PlaybackSourceResolution } from '../playback'
import type { Component } from 'solid-js'
import { createRendererRegistry, type RendererRegistry } from '../open/renderer-registry'
import type {
  BrowseProvider,
  AssistantProvider,
  ContentCodecDescriptor,
  ContentDecodeResult,
  ContentLifecycleDescriptor,
  ContentLiveStatus,
  ContentPresentation,
  ContentPresentationDescriptor,
  ContentRendererDescriptor,
  ContentSanitizerDescriptor,
  ContentSurfaceDescriptor,
  IntegrationModule,
  InspectProvider,
  PaneContribution,
  PlaybackContribution,
  ResourceActionProvider,
  ResourceRouteProvider,
} from './contracts'
import type { OpenContext, OpenIntent } from '../open/open-resource'
import type { SearchContributor } from '../search/contracts'

export type ContentRegistry = Readonly<{
  modules: readonly IntegrationModule[]
  rendererRegistry: RendererRegistry
  module(id: string): IntegrationModule | null
  browse(location: ResourceKey): BrowseProvider | null
  inspect(resource: ResourceKey): InspectProvider | null
  openRoute(resource: ResourceSummary, intent: OpenIntent, context: OpenContext): Promise<boolean>
  actions(resource: ResourceSummary): ResourceActionProvider | null
  playbackItem(resource: ResourceSummary): PlaybackItem | null
  playbackQueue(
    resources: readonly ResourceSummary[],
    current: PlaybackItem,
  ): readonly PlaybackItem[]
  resolvePlaybackSource(
    request: PlaybackSourceRequest,
  ): PlaybackSourceResolution | Promise<PlaybackSourceResolution>
  playbackLifecycles(): readonly Component[]
  roots(): readonly ResourceSummary[]
  searches(): readonly SearchContributor[]
  assistants(): readonly AssistantProvider[]
  panes(kind?: string): readonly PaneContribution[]
  renderer(instance: ContentInstance): ContentRendererDescriptor | null
  surface(instance: ContentInstance): ContentSurfaceDescriptor | null
  codec(id: string): ContentCodecDescriptor | null
  isDurable(instance: ContentInstance): boolean
  preservesRuntime(instance: ContentInstance): boolean
  sanitize(instance: ContentInstance): ContentInstance | null
  presentation(instance: ContentInstance): ContentPresentation | null
  liveStatus(instance: ContentInstance): ContentLiveStatus | null
  lifecycle(instance: ContentInstance): ContentLifecycleDescriptor | null
  encode(instance: ContentInstance, codecId?: string): PersistedContentEnvelope
  decode(value: unknown): ContentDecodeResult
}>

type Owned<T> = Readonly<{ moduleId: string; descriptor: T }>
type IntegrationLiveCapability = keyof Pick<
  IntegrationModule,
  'browse' | 'inspect' | 'actions' | 'search'
>

function requireId(id: string, label: string): string {
  if (!id.trim()) throw new Error(`${label} id must not be empty`)
  return id
}

function moduleOwnsInstance(moduleId: string, instance: ContentInstance): boolean {
  switch (instance.type) {
    case 'explorer':
      return instance.location.provider === moduleId
    case 'resource':
      return instance.resource.provider === moduleId
    case 'integration':
      return instance.integration === moduleId
  }
}

function playbackContribution(
  modules: ReadonlyMap<string, IntegrationModule>,
  moduleEnabled: (moduleId: string) => boolean,
  provider: string,
): PlaybackContribution | null {
  if (!moduleEnabled(provider)) return null
  return modules.get(provider)?.playback ?? null
}

function descriptorAcceptsInstance(
  moduleId: string,
  descriptor: Pick<ContentCodecDescriptor | ContentSanitizerDescriptor, 'supports'>,
  instance: ContentInstance,
): boolean {
  return (
    moduleOwnsInstance(moduleId, instance) &&
    (descriptor.supports === undefined || descriptor.supports(instance))
  )
}

function uniqueDescriptors<T extends { id: string }>(
  values: readonly Owned<T>[],
  label: string,
): Map<string, Owned<T>> {
  const result = new Map<string, Owned<T>>()
  for (const value of values) {
    requireId(value.descriptor.id, label)
    if (result.has(value.descriptor.id)) {
      throw new Error(`Duplicate ${label} id: ${value.descriptor.id}`)
    }
    result.set(value.descriptor.id, value)
  }
  return result
}

export function createContentRegistry(
  modules: readonly IntegrationModule[],
  options: Readonly<{
    enabled?: (moduleId: string, capability?: IntegrationLiveCapability) => boolean
    root?: (moduleId: string, staticRoot: ResourceSummary | undefined) => ResourceSummary | null
  }> = {},
): ContentRegistry {
  const moduleEnabled = options.enabled ?? (() => true)
  const moduleRoot = options.root ?? ((_, root) => root ?? null)
  const byModule = new Map<string, IntegrationModule>()
  for (const module of modules) {
    requireId(module.id, 'Integration')
    if (byModule.has(module.id)) throw new Error(`Duplicate integration id: ${module.id}`)
    byModule.set(module.id, module)
  }

  const ownedRenderers = modules.flatMap((module) =>
    (module.content ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
  )
  const allRendererRegistry = createRendererRegistry(
    ownedRenderers.map((value) => value.descriptor),
  )
  const rendererRegistriesByModule = new Map(
    modules.map((module) => [module.id, createRendererRegistry(module.content ?? [])]),
  )
  const rendererRegistry: RendererRegistry = Object.freeze({
    resolve(resource, intent) {
      return (
        rendererRegistriesByModule.get(resource.key.provider)?.resolve(resource, intent) ?? null
      )
    },
    get: (id) => allRendererRegistry.get(id),
    load: (id) => allRendererRegistry.load(id),
  })
  const rendererById = new Map(ownedRenderers.map((value) => [value.descriptor.id, value]))
  const codecs = uniqueDescriptors(
    modules.flatMap((module) =>
      (module.codecs ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
    ),
    'content codec',
  )
  const sanitizers = uniqueDescriptors(
    modules.flatMap((module) =>
      (module.sanitizers ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
    ),
    'content sanitizer',
  )
  const presentations = uniqueDescriptors(
    modules.flatMap((module) =>
      (module.presentations ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
    ),
    'content presentation',
  )
  const lifecycles = uniqueDescriptors(
    modules.flatMap((module) =>
      (module.lifecycles ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
    ),
    'content lifecycle',
  )
  for (const { descriptor } of codecs.values()) {
    if (!Number.isSafeInteger(descriptor.version) || descriptor.version <= 0) {
      throw new Error(`Content codec ${descriptor.id} has an invalid version`)
    }
  }

  const frozenModules = Object.freeze([...modules])
  const searches = uniqueDescriptors(
    modules.flatMap((module) =>
      (module.search ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
    ),
    'search contributor',
  )
  const panes = uniqueDescriptors(
    modules.flatMap((module) =>
      (module.panes ?? []).map((descriptor) => ({ moduleId: module.id, descriptor })),
    ),
    'pane contribution',
  )
  const registry: ContentRegistry = Object.freeze({
    modules: frozenModules,
    rendererRegistry,
    module(id) {
      return byModule.get(id) ?? null
    },
    browse(location) {
      return moduleEnabled(location.provider, 'browse')
        ? (byModule.get(location.provider)?.browse ?? null)
        : null
    },
    inspect(resource) {
      return moduleEnabled(resource.provider, 'inspect')
        ? (byModule.get(resource.provider)?.inspect ?? null)
        : null
    },
    async openRoute(resource, intent, context) {
      if (!moduleEnabled(resource.key.provider)) return false
      const routes: ResourceRouteProvider | undefined = byModule.get(resource.key.provider)?.routes
      return (await routes?.open(resource, intent, context)) ?? false
    },
    actions(resource) {
      return moduleEnabled(resource.key.provider, 'actions')
        ? (byModule.get(resource.key.provider)?.actions ?? null)
        : null
    },
    playbackItem(resource) {
      return (
        playbackContribution(byModule, moduleEnabled, resource.key.provider)?.createItem(
          resource,
        ) ?? null
      )
    },
    playbackQueue(resources, current) {
      const contribution = playbackContribution(byModule, moduleEnabled, current.resource.provider)
      if (!contribution) return []
      return contribution.createQueue(
        resources.filter((resource) => resource.key.provider === current.resource.provider),
        current,
      )
    },
    resolvePlaybackSource(request) {
      const provider = request.item.resource.provider
      const contribution = playbackContribution(byModule, moduleEnabled, provider)
      if (!contribution) {
        return {
          kind: 'error',
          message: `No playback contribution registered for provider: ${provider}`,
        }
      }
      return contribution.resolveSource(request)
    },
    playbackLifecycles() {
      return frozenModules.flatMap((module) =>
        moduleEnabled(module.id) && module.playback?.lifecycle ? [module.playback.lifecycle] : [],
      )
    },
    roots() {
      return frozenModules.flatMap((module) => {
        if (!moduleEnabled(module.id, 'browse')) return []
        const root = moduleRoot(module.id, module.root)
        return root ? [root] : []
      })
    },
    searches() {
      return [...searches.values()]
        .filter((value) => moduleEnabled(value.moduleId, 'search'))
        .map((value) => value.descriptor)
    },
    assistants() {
      return frozenModules.flatMap((module) =>
        moduleEnabled(module.id) && module.assistant ? [module.assistant] : [],
      )
    },
    panes(kind) {
      const values = [...panes.values()]
        .filter((value) => moduleEnabled(value.moduleId))
        .map((value) => value.descriptor)
      return kind === undefined ? values : values.filter((pane) => pane.kind === kind)
    },
    renderer(instance) {
      if (instance.type === 'resource') {
        const owned = rendererById.get(instance.renderer)
        if (!owned || !moduleOwnsInstance(owned.moduleId, instance)) return null
        if (owned.descriptor.matchesContent && !owned.descriptor.matchesContent(instance)) {
          return null
        }
        return owned.descriptor
      }
      for (const { moduleId, descriptor } of ownedRenderers) {
        if (moduleOwnsInstance(moduleId, instance) && descriptor.matchesContent?.(instance)) {
          return descriptor
        }
      }
      return null
    },
    surface(instance) {
      const moduleId =
        instance.type === 'integration'
          ? instance.integration
          : instance.type === 'resource'
            ? instance.resource.provider
            : instance.location.provider
      const surface = byModule.get(moduleId)?.surface
      return surface?.supports(instance) ? surface : null
    },
    codec(id) {
      return codecs.get(id)?.descriptor ?? null
    },
    isDurable(instance) {
      const codec = [...codecs.values()].find(({ moduleId, descriptor }) =>
        descriptorAcceptsInstance(moduleId, descriptor, instance),
      )
      return !!codec && (codec.descriptor.durable?.(instance) ?? true)
    },
    preservesRuntime(instance) {
      const codec = [...codecs.values()].find(({ moduleId, descriptor }) =>
        descriptorAcceptsInstance(moduleId, descriptor, instance),
      )
      return !!codec && (codec.descriptor.preserveRuntime?.(instance) ?? false)
    },
    sanitize(instance) {
      let current: ContentInstance | null = instance
      for (const { moduleId, descriptor } of sanitizers.values()) {
        if (!current) break
        if (descriptorAcceptsInstance(moduleId, descriptor, current)) {
          const sanitized = descriptor.sanitize(current)
          current =
            sanitized && isContentInstance(sanitized) && moduleOwnsInstance(moduleId, sanitized)
              ? sanitized
              : null
        }
      }
      return current
    },
    presentation(instance) {
      for (const { moduleId, descriptor } of presentations.values()) {
        if (!moduleOwnsInstance(moduleId, instance)) continue
        const value = descriptor.describe(instance)
        if (value) return value
      }
      return null
    },
    liveStatus(instance) {
      for (const module of frozenModules) {
        if (!moduleEnabled(module.id) || !moduleOwnsInstance(module.id, instance)) continue
        const value = module.status?.describe(instance)
        if (value) return value
      }
      return null
    },
    lifecycle(instance) {
      for (const { moduleId, descriptor } of lifecycles.values()) {
        if (moduleOwnsInstance(moduleId, instance) && descriptor.supports(instance)) {
          return descriptor
        }
      }
      return null
    },
    encode(instance, codecId) {
      const codec = codecId
        ? codecs.get(codecId)
        : [...codecs.values()].find(({ moduleId, descriptor }) =>
            descriptorAcceptsInstance(moduleId, descriptor, instance),
          )
      if (!codec) {
        throw new Error(
          codecId ? `Unknown content codec: ${codecId}` : 'No content codec accepts instance',
        )
      }
      if (!descriptorAcceptsInstance(codec.moduleId, codec.descriptor, instance)) {
        throw new Error(`Content codec ${codec.descriptor.id} does not accept instance`)
      }
      return Object.freeze({
        schemaVersion: CONTENT_ENVELOPE_SCHEMA_VERSION,
        codec: codec.descriptor.id,
        codecVersion: codec.descriptor.version,
        payload: codec.descriptor.encode(instance),
      })
    },
    decode(value) {
      if (!isPersistedContentEnvelope(value)) {
        return {
          ok: false,
          reason: 'Invalid persisted content envelope',
          recoverable: value,
        }
      }
      const ownedCodec = codecs.get(value.codec)
      if (!ownedCodec) {
        return {
          ok: false,
          reason: `Unknown content codec: ${value.codec}`,
          recoverable: value,
        }
      }
      const decoded = ownedCodec.descriptor.decode(value.payload, value.codecVersion)
      if (!decoded.ok) return { ...decoded, recoverable: value }
      if (!isContentInstance(decoded.instance)) {
        return {
          ok: false,
          reason: `Content codec ${ownedCodec.descriptor.id} returned invalid content`,
          recoverable: value,
        }
      }
      if (
        !descriptorAcceptsInstance(ownedCodec.moduleId, ownedCodec.descriptor, decoded.instance)
      ) {
        return {
          ok: false,
          reason: `Content codec ${ownedCodec.descriptor.id} returned foreign content`,
          recoverable: value,
        }
      }
      const sanitized = registry.sanitize(decoded.instance)
      return sanitized
        ? { ok: true, instance: sanitized }
        : {
            ok: false,
            reason: `Content codec ${ownedCodec.descriptor.id} returned rejected content`,
            recoverable: value,
          }
    },
  })
  return registry
}
