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

export type PersistedContentWindowRecord = Readonly<{
  id: string
  title: string
  iconName?: string | null
  content: PersistedContentEnvelope
}> &
  Record<string, unknown>

export function persistedContentWindowRecord<T extends ContentWindowDefinition>(
  persistence: ContentWindowPersistencePort,
  window: T,
): PersistedContentWindowRecord | null {
  const encoded = persistence.encode(window)
  const live = persistence.contentInstance(window)
  const content =
    encoded ?? (live === null && isPersistedContentEnvelope(window.content) ? window.content : null)
  if (!content) return null
  const {
    contentInstance: _contentInstance,
    content: _content,
    contentRecoveryReason: _contentRecoveryReason,
    ...host
  } = window
  return { ...host, id: window.id, title: window.title, content }
}

export function restorePersistedContentWindow(
  persistence: ContentWindowPersistencePort,
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
  if (!isPersistedContentEnvelope(raw.content)) return null
  const restored = persistence.decode(raw.content, { id: raw.id })
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
