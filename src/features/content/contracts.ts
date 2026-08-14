import {
  type ResourceError,
  type ResourceKey,
  type ResourcePage,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type { ContentInstance } from '@/lib/domain/content'
import type { OpenDisposition, OpenReadyPlan, OpenSurface } from '@/src/features/open/open-resource'
import type { RendererDescriptor } from '@/src/features/open/renderer-registry'

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
  encode(instance: ContentInstance): unknown
  decode(value: unknown, encodedVersion?: number): ContentDecodeResult
}>

export type ContentSanitizerDescriptor = Readonly<{
  id: string
  supports?: (instance: ContentInstance) => boolean
  sanitize(instance: ContentInstance): ContentInstance | null
}>

export type ContentPresentation = Readonly<{
  title: string
  icon?: string
  subtitle?: string
  status?: Readonly<{ label: string; tone?: string }>
  preferredSize?: Readonly<{ width: number; height: number }>
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

export type HostOpenPlan<TDisposition extends OpenDisposition> = OpenReadyPlan &
  Readonly<{ disposition: TDisposition }>

export interface SurfaceContentHost<
  TSurface extends OpenSurface,
  TDisposition extends OpenDisposition,
> {
  readonly surface: TSurface
  open(plan: HostOpenPlan<TDisposition>): void
  close(instanceId: string): void
  focus(instanceId: string): void
}

export interface LibraryHost extends SurfaceContentHost<
  'library',
  'replace' | 'modal' | 'fullscreen'
> {}

export interface WorkspaceHost extends SurfaceContentHost<
  'workspace',
  'replace' | 'pane' | 'window'
> {}

export interface CanvasHost extends SurfaceContentHost<'canvas', 'window'> {}

export type BrowseRequest = Readonly<{
  location: ResourceKey
  cursor?: string
  limit?: number
  signal?: AbortSignal
}>

export interface BrowseProvider {
  browse(request: BrowseRequest): Promise<ResourcePage>
}

export type ResourceActionDescriptor = Readonly<{
  id: string
  label: string
  capability: string
  icon?: string
  dangerous?: boolean
  interaction?: 'immediate' | 'name' | 'destination' | 'upload' | 'paste' | 'text' | 'appearance'
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

export interface IntegrationModule {
  readonly id: string
  readonly browse?: BrowseProvider
  readonly actions?: ResourceActionProvider
  readonly content?: readonly ContentRendererDescriptor[]
  readonly codecs?: readonly ContentCodecDescriptor[]
  readonly sanitizers?: readonly ContentSanitizerDescriptor[]
  readonly presentations?: readonly ContentPresentationDescriptor[]
  readonly lifecycles?: readonly ContentLifecycleDescriptor[]
}

export function defineIntegrationModule<const T extends IntegrationModule>(module: T): T {
  if (!module.id.trim()) throw new Error('Integration id must not be empty')
  return module
}
