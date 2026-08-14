import type { ContentInstance } from '@/lib/domain/content'
import type { ResourceSummary } from '@/lib/domain/resource'
import type { JSX } from 'solid-js'

export type RendererIntent = 'default' | 'view' | 'read' | 'play'

type RendererRuleBase = Readonly<{
  intents?: readonly RendererIntent[]
}>

export type RendererRule =
  | (RendererRuleBase & { type: 'kind'; value: string })
  | (RendererRuleBase & { type: 'mime'; value: string })
  | (RendererRuleBase & { type: 'mimePrefix'; value: string })
  | (RendererRuleBase & { type: 'presentation'; value: string })
  | (RendererRuleBase & { type: 'fallback' })

export type ContentRendererMountCallbacks = Readonly<{
  replace(instance: ContentInstance): void
  open?: (instance: ContentInstance) => void
  close?: () => void
  focus?: () => void
  active?: () => boolean
}>

export type ContentRendererMountContext = ContentRendererMountCallbacks &
  Readonly<{
    instance: () => ContentInstance
    active: () => boolean
  }>

export type ContentRendererModule =
  | Readonly<{
      kind: 'content'
      mount(context: ContentRendererMountContext): JSX.Element
    }>
  | Readonly<{
      kind: 'playback'
      media: 'audio' | 'video'
      component: () => JSX.Element
    }>

export function isContentRendererModule(value: unknown): value is ContentRendererModule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const module = value as Record<string, unknown>
  if (module.kind === 'content') return typeof module.mount === 'function'
  return (
    module.kind === 'playback' &&
    (module.media === 'audio' || module.media === 'video') &&
    typeof module.component === 'function'
  )
}

export type RendererDescriptor = Readonly<{
  id: string
  rules: readonly RendererRule[]
  requiresAnyCapability?: readonly string[]
  load: () => Promise<ContentRendererModule>
}>

export type RendererRegistry = Readonly<{
  resolve(resource: ResourceSummary, intent: RendererIntent): RendererDescriptor | null
  get(id: string): RendererDescriptor | null
  load(id: string): Promise<ContentRendererModule>
}>

function normalizedMime(mime: string | undefined): string | undefined {
  return mime?.split(';', 1)[0]?.trim().toLowerCase() || undefined
}

function ruleScore(
  rule: RendererRule,
  resource: ResourceSummary,
  intent: RendererIntent,
): number | null {
  if (rule.intents && !rule.intents.includes(intent)) return null
  switch (rule.type) {
    case 'kind':
      return resource.kind === rule.value ? 400 : null
    case 'mime':
      return normalizedMime(resource.mime) === rule.value.toLowerCase() ? 300 : null
    case 'mimePrefix':
      return normalizedMime(resource.mime)?.startsWith(rule.value.toLowerCase()) ? 250 : null
    case 'presentation':
      return resource.presentation === rule.value ? 200 : null
    case 'fallback':
      return 0
  }
}

export function createRendererRegistry(
  descriptors: readonly RendererDescriptor[],
): RendererRegistry {
  const byId = new Map<string, RendererDescriptor>()
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error('Renderer id must not be empty')
    if (!descriptor.rules.length) throw new Error(`Renderer ${descriptor.id} has no match rules`)
    if (byId.has(descriptor.id)) throw new Error(`Duplicate renderer id: ${descriptor.id}`)
    byId.set(descriptor.id, descriptor)
  }

  return Object.freeze({
    resolve(resource: ResourceSummary, intent: RendererIntent) {
      let match: RendererDescriptor | null = null
      let bestScore = -1
      for (const descriptor of descriptors) {
        for (const rule of descriptor.rules) {
          const score = ruleScore(rule, resource, intent)
          if (score !== null && score > bestScore) {
            match = descriptor
            bestScore = score
          }
        }
      }
      return match
    },
    get(id: string) {
      return byId.get(id) ?? null
    },
    async load(id: string) {
      const descriptor = byId.get(id)
      if (!descriptor) throw new Error(`Unknown renderer id: ${id}`)
      const module = await descriptor.load()
      if (!isContentRendererModule(module)) {
        throw new Error(`Renderer ${id} returned an invalid module`)
      }
      return module
    },
  })
}
