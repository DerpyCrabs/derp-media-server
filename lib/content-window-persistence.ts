import {
  isPersistedContentEnvelope,
  type ContentInstance,
  type PersistedContentEnvelope,
} from './domain/content'
import type { ContentWindowDefinition } from './content-window'

type ContentWindowDecodeResult =
  | Readonly<{
      ok: true
      instance: ContentInstance
    }>
  | Readonly<{ ok: false; reason: string; recoverable: unknown }>

export type ContentWindowPersistencePort = Readonly<{
  contentInstance(window: ContentWindowDefinition): ContentInstance | null
  encode(window: ContentWindowDefinition): PersistedContentEnvelope | null
  decode(content: unknown, fallback: Readonly<{ id: string }>): ContentWindowDecodeResult
  isRuntimeOnly(window: ContentWindowDefinition): boolean
}>

let persistencePort: ContentWindowPersistencePort | undefined

export function installContentWindowPersistencePort(port: ContentWindowPersistencePort): void {
  persistencePort = port
}

function port(): ContentWindowPersistencePort {
  if (!persistencePort) {
    throw new Error('Content window persistence is not installed by the application')
  }
  return persistencePort
}

export function isRuntimeOnlyPersistedContentWindow(window: ContentWindowDefinition): boolean {
  return port().isRuntimeOnly(window)
}

export function persistedContentWindowRecord<T extends ContentWindowDefinition>(
  window: T,
): Record<string, unknown> | null {
  const adapter = port()
  const encoded = adapter.encode(window)
  const live = adapter.contentInstance(window)
  const content =
    encoded ?? (live === null && isPersistedContentEnvelope(window.content) ? window.content : null)
  if (!content) return null
  const {
    contentInstance: _contentInstance,
    content: _content,
    contentRecoveryReason: _contentRecoveryReason,
    ...host
  } = window
  return { ...host, content }
}

export function restorePersistedContentWindow(
  value: unknown,
  hostFields: readonly string[],
): (ContentWindowDefinition & Record<string, unknown>) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const allowedFields = new Set(['id', 'title', 'iconName', 'content', ...hostFields])
  if (Object.keys(raw).some((key) => !allowedFields.has(key))) return null
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.title !== 'string') return null
  if (raw.iconName !== undefined && raw.iconName !== null && typeof raw.iconName !== 'string') {
    return null
  }
  const adapter = port()
  if (!isPersistedContentEnvelope(raw.content)) return null
  const restored = adapter.decode(raw.content, { id: raw.id })
  if (!restored.ok) {
    return {
      ...raw,
      id: raw.id,
      title: raw.title,
      content: raw.content,
      contentRecoveryReason: restored.reason,
    } as ContentWindowDefinition & Record<string, unknown>
  }
  return {
    ...raw,
    id: raw.id,
    title: raw.title,
    content: raw.content,
    contentInstance: restored.instance,
  } as ContentWindowDefinition & Record<string, unknown>
}
