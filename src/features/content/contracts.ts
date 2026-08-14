import {
  type ResourceError,
  type ResourceKey,
  type ResourcePage,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type { ContentInstance } from '@/lib/domain/content'
import type {
  ContentRendererMountCallbacks,
  RendererDescriptor,
} from '@/src/features/open/renderer-registry'
import type {
  PlaybackItem,
  PlaybackSourceRequest,
  PlaybackSourceResolution,
} from '@/src/features/playback'
import type { SearchContributor } from '@/src/features/search/contracts'
import type { ContentRuntime } from './runtime'
import type { Accessor, Component, JSX } from 'solid-js'

export {
  CONTENT_ENVELOPE_SCHEMA_VERSION,
  isContentInstance,
  isPersistedContentEnvelope,
} from '@/lib/domain/content'
export type {
  ContentInstance,
  ExplorerContentInstance,
  IntegrationContentInstance,
  PersistedContentEnvelope,
  ResourceContentInstance,
} from '@/lib/domain/content'

export type ContentDecodeResult =
  | Readonly<{ ok: true; instance: ContentInstance }>
  | Readonly<{ ok: false; reason: string; recoverable: unknown }>

export type ContentCodecDescriptor = Readonly<{
  id: string
  version: number
  supports?: (instance: ContentInstance) => boolean
  durable?: (instance: ContentInstance) => boolean
  preserveRuntime?: (instance: ContentInstance) => boolean
  encode(instance: ContentInstance): unknown
  decode(value: unknown, encodedVersion: number): ContentDecodeResult
}>

export type ContentSanitizerDescriptor = Readonly<{
  id: string
  supports?: (instance: ContentInstance) => boolean
  sanitize(instance: ContentInstance): ContentInstance | null
}>

export type ContentCategory =
  | 'folder'
  | 'audio'
  | 'video'
  | 'image'
  | 'text'
  | 'pdf'
  | 'book'
  | 'file'
  | 'collection'

export type ContentPresentation = Readonly<{
  title: string
  category?: ContentCategory
  icon?: string
  subtitle?: string
  status?: Readonly<{ label: string; tone?: string }>
  preferredSize?: Readonly<{ width: number; height: number }>
}>

export type ContentLiveStatus = Readonly<{
  needsInput: boolean
  working: boolean
  failed: boolean
  unread: boolean
}>

export type ContentStatusDescriptor = Readonly<{
  describe(instance: ContentInstance): ContentLiveStatus | null
}>

export type ContentPresentationDescriptor = Readonly<{
  id: string
  describe(instance: ContentInstance): ContentPresentation | null
}>

export type ContentLifecycleDescriptor = Readonly<{
  id: string
  supports(instance: ContentInstance): boolean
  canClose?(instance: ContentInstance): boolean | Promise<boolean>
  dispose?(instance: ContentInstance): void | Promise<void>
}>

export type ContentRendererDescriptor = RendererDescriptor &
  Readonly<{
    matchesContent?: (instance: ContentInstance) => boolean
  }>

export type ContentSurfaceMountContext = ContentRendererMountCallbacks &
  Readonly<{
    runtime: ContentRuntime
    instance: Accessor<ContentInstance>
    visible: Accessor<boolean>
    active: Accessor<boolean>
  }>

export type ContentSurfaceModule = Readonly<{
  mount(context: ContentSurfaceMountContext): JSX.Element
}>

export type ContentSurfaceDescriptor = Readonly<{
  supports(instance: ContentInstance): boolean
  load(): Promise<ContentSurfaceModule>
}>

export type BrowseRequest = Readonly<{
  location: ResourceKey
  cursor?: string
  limit?: number
  signal?: AbortSignal
}>

export interface BrowseProvider {
  browse(request: BrowseRequest): Promise<ResourcePage>
}

export interface InspectProvider {
  inspect(resource: ResourceKey, signal?: AbortSignal): Promise<ResourceSummary>
}

export type PlaybackContribution = Readonly<{
  createItem(resource: ResourceSummary): PlaybackItem | null
  createQueue(resources: readonly ResourceSummary[], current: PlaybackItem): readonly PlaybackItem[]
  resolveSource(
    request: PlaybackSourceRequest,
  ): PlaybackSourceResolution | Promise<PlaybackSourceResolution>
  lifecycle?: Component
}>

export type ResourceActionForm =
  | Readonly<{
      kind: 'choice'
      title: string
      submitLabel: string
      choices: readonly Readonly<{ label: string; value: string }>[]
    }>
  | Readonly<{
      kind: 'project'
      title: string
      submitLabel: string
    }>
  | Readonly<{
      kind: 'appearance'
      title: string
      submitLabel: string
      icons: readonly string[]
    }>

export type ResourceActionDescriptor = Readonly<{
  id: string
  operation: string
  label: string
  capability: string
  icon?: string
  dangerous?: boolean
  optimisticEffect?: 'rename' | 'delete'
  interaction: 'immediate' | 'name' | 'destination' | 'upload' | 'paste' | 'text' | 'appearance'
  form?: ResourceActionForm
}>

export type ResourceActionRequest = Readonly<{
  actionId: string
  resource: ResourceSummary
  input?: unknown
  signal?: AbortSignal
}>

export type ResourceActionOutcome =
  | void
  | ResourceError
  | Readonly<{ content?: ContentInstance; value?: unknown }>

export interface ResourceActionProvider {
  list(resource: ResourceSummary): readonly ResourceActionDescriptor[]
  run(request: ResourceActionRequest): Promise<ResourceActionOutcome>
}

export type AssistantAttachment = Readonly<{
  name: string
  mimeType: string
  contentBase64: string
}>

export type AssistantCompletionRequest = Readonly<{
  prompt: string
  attachments?: readonly AssistantAttachment[]
  timeoutMs?: number
}>

export interface AssistantProvider {
  available(): Promise<boolean>
  complete(request: AssistantCompletionRequest): Promise<string>
}

export type PaneContribution = Readonly<{
  id: string
  kind: string
  label: string
  create(instanceId: string): ContentInstance
}>

export interface IntegrationModule {
  readonly id: string
  readonly name?: string
  readonly root?: ResourceSummary
  readonly browse?: BrowseProvider
  readonly inspect?: InspectProvider
  readonly actions?: ResourceActionProvider
  readonly playback?: PlaybackContribution
  readonly content?: readonly ContentRendererDescriptor[]
  readonly surface?: ContentSurfaceDescriptor
  readonly codecs?: readonly ContentCodecDescriptor[]
  readonly sanitizers?: readonly ContentSanitizerDescriptor[]
  readonly presentations?: readonly ContentPresentationDescriptor[]
  readonly status?: ContentStatusDescriptor
  readonly lifecycles?: readonly ContentLifecycleDescriptor[]
  readonly search?: readonly SearchContributor[]
  readonly assistant?: AssistantProvider
  readonly panes?: readonly PaneContribution[]
}

export function defineIntegrationModule<const T extends IntegrationModule>(module: T): T {
  if (!module.id.trim()) throw new Error('Integration id must not be empty')
  return module
}
