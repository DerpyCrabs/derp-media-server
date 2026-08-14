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

export const BUILT_IN_RENDERER_ID = {
  audio: 'audio-player',
  video: 'video-player',
  image: 'image-viewer',
  text: 'text-viewer',
  pdf: 'pdf-reader',
  book: 'book-reader',
  folderReader: 'folder-reader',
  unsupported: 'unsupported-file',
} as const

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

const defaultAndView = ['default', 'view'] as const
const defaultViewAndRead = ['default', 'view', 'read'] as const
const defaultViewAndPlay = ['default', 'view', 'play'] as const

export const builtInRendererDescriptors: readonly RendererDescriptor[] = [
  {
    id: BUILT_IN_RENDERER_ID.folderReader,
    rules: [{ type: 'kind', value: 'folder', intents: ['read'] }],
    requiresAnyCapability: ['browse'],
    load: async () => {
      await import('../reader/ReaderContent')
      return {
        kind: 'content',
        mount: () => {
          throw new Error('Reader renderer requires an integration mount adapter')
        },
      }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.video,
    rules: [
      { type: 'mime', value: 'video/ogg', intents: defaultViewAndPlay },
      { type: 'mime', value: 'application/ogg', intents: defaultViewAndPlay },
      { type: 'mimePrefix', value: 'video/', intents: defaultViewAndPlay },
      { type: 'presentation', value: 'video', intents: defaultViewAndPlay },
    ],
    requiresAnyCapability: ['stream', 'read'],
    load: async () => {
      const module = await import('../../media/VideoPlayer')
      return { kind: 'playback', media: 'video', component: module.VideoPlayer }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.audio,
    rules: [
      { type: 'mimePrefix', value: 'audio/', intents: defaultViewAndPlay },
      { type: 'presentation', value: 'audio', intents: defaultViewAndPlay },
    ],
    requiresAnyCapability: ['stream', 'read'],
    load: async () => {
      const module = await import('../../media/AudioPlayer')
      return { kind: 'playback', media: 'audio', component: module.AudioPlayer }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.image,
    rules: [
      { type: 'mimePrefix', value: 'image/', intents: defaultAndView },
      { type: 'presentation', value: 'image', intents: defaultAndView },
    ],
    requiresAnyCapability: ['read'],
    load: async () => {
      await import('../viewer/ImageViewerContent')
      return {
        kind: 'content',
        mount: () => {
          throw new Error('Image renderer requires an integration mount adapter')
        },
      }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.text,
    rules: [
      { type: 'mimePrefix', value: 'text/', intents: defaultAndView },
      { type: 'mime', value: 'application/json', intents: defaultAndView },
      { type: 'mime', value: 'application/xml', intents: defaultAndView },
      { type: 'mime', value: 'application/javascript', intents: defaultAndView },
      { type: 'mime', value: 'application/typescript', intents: defaultAndView },
      { type: 'presentation', value: 'text', intents: defaultAndView },
    ],
    requiresAnyCapability: ['read'],
    load: async () => {
      await import('../viewer/TextViewerContent')
      return {
        kind: 'content',
        mount: () => {
          throw new Error('Text renderer requires an integration mount adapter')
        },
      }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.pdf,
    rules: [
      { type: 'mime', value: 'application/pdf', intents: defaultViewAndRead },
      { type: 'presentation', value: 'pdf', intents: defaultViewAndRead },
    ],
    requiresAnyCapability: ['read'],
    load: async () => {
      await import('../reader/ReaderContent')
      return {
        kind: 'content',
        mount: () => {
          throw new Error('PDF renderer requires an integration mount adapter')
        },
      }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.book,
    rules: [
      { type: 'mime', value: 'application/epub+zip', intents: defaultViewAndRead },
      { type: 'mime', value: 'application/x-fictionbook+xml', intents: defaultViewAndRead },
      { type: 'presentation', value: 'book', intents: defaultViewAndRead },
    ],
    requiresAnyCapability: ['read'],
    load: async () => {
      await import('../reader/ReaderContent')
      return {
        kind: 'content',
        mount: () => {
          throw new Error('Book renderer requires an integration mount adapter')
        },
      }
    },
  },
  {
    id: BUILT_IN_RENDERER_ID.unsupported,
    rules: [{ type: 'fallback', intents: defaultAndView }],
    requiresAnyCapability: ['read', 'download'],
    load: async () => {
      await import('../viewer/UnsupportedViewerContent')
      return {
        kind: 'content',
        mount: () => {
          throw new Error('Unsupported renderer requires an integration mount adapter')
        },
      }
    },
  },
]
