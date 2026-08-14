import {
  isResourceKey,
  type ResourceError,
  type ResourceKey,
  type ResourcePage,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type { OpenDisposition, OpenReadyPlan, OpenSurface } from '@/src/features/open/open-resource'
import type { RendererDescriptor } from '@/src/features/open/renderer-registry'

export type ContentInstance =
  | Readonly<{
      id: string
      type: 'explorer'
      location: ResourceKey
    }>
  | Readonly<{
      id: string
      type: 'resource'
      resource: ResourceKey
      renderer: string
    }>
  | Readonly<{
      id: string
      type: 'integration'
      integration: string
      view: string
      state: unknown
    }>

export type ContentDecodeResult =
  | Readonly<{ ok: true; instance: ContentInstance }>
  | Readonly<{ ok: false; reason: string; recoverable: unknown }>

export type ContentCodecDescriptor = Readonly<{
  id: string
  version: number
  encode(instance: ContentInstance): unknown
  decode(value: unknown): ContentDecodeResult
}>

export type ContentSanitizerDescriptor = Readonly<{
  id: string
  sanitize(instance: ContentInstance): ContentInstance | null
}>

type HostOpenPlan<TDisposition extends OpenDisposition> = OpenReadyPlan &
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

export type SearchRequest = Readonly<{
  query: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}>

export type ResourceSearchPage = Readonly<{
  items: readonly ResourceSummary[]
  nextCursor?: string
  total: number
}>

export interface SearchContributor {
  search(request: SearchRequest): Promise<ResourceSearchPage>
}

export type ResourceActionDescriptor = Readonly<{
  id: string
  label: string
  capability: string
}>

export type ResourceActionRequest = Readonly<{
  actionId: string
  resource: ResourceSummary
  signal?: AbortSignal
}>

export interface ResourceActionProvider {
  list(resource: ResourceSummary): readonly ResourceActionDescriptor[]
  run(request: ResourceActionRequest): Promise<void | ResourceError>
}

export interface IntegrationModule {
  readonly id: string
  readonly browse?: BrowseProvider
  readonly search?: SearchContributor
  readonly actions?: ResourceActionProvider
  readonly content?: readonly RendererDescriptor[]
  readonly codecs?: readonly ContentCodecDescriptor[]
  readonly sanitizers?: readonly ContentSanitizerDescriptor[]
}

export function defineIntegrationModule<const T extends IntegrationModule>(module: T): T {
  if (!module.id.trim()) throw new Error('Integration id must not be empty')
  return module
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function isContentInstance(value: unknown): value is ContentInstance {
  const instance = record(value)
  if (!instance || typeof instance.id !== 'string' || !instance.id) return false
  if (instance.type === 'explorer') {
    return hasOnlyKeys(instance, ['id', 'type', 'location']) && isResourceKey(instance.location)
  }
  if (instance.type === 'resource') {
    return !!(
      hasOnlyKeys(instance, ['id', 'type', 'resource', 'renderer']) &&
      isResourceKey(instance.resource) &&
      typeof instance.renderer === 'string' &&
      instance.renderer
    )
  }
  if (instance.type === 'integration') {
    return !!(
      hasOnlyKeys(instance, ['id', 'type', 'integration', 'view', 'state']) &&
      typeof instance.integration === 'string' &&
      instance.integration &&
      typeof instance.view === 'string' &&
      instance.view &&
      Object.prototype.hasOwnProperty.call(instance, 'state')
    )
  }
  return false
}
