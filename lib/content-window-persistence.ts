import { isPersistedContentEnvelope } from './domain/content'
import type { ContentWindowDefinition } from './content-window'
import {
  contentInstanceFromCurrentWindow,
  currentWindowFromPersistedContent,
  hasDisallowedPersistedContentFields,
  persistedContentFromCurrentWindow,
} from '@/src/integrations/current-window-content'

export function persistedContentWindowRecord<T extends ContentWindowDefinition>(
  window: T,
): Record<string, unknown> | null {
  const encoded = persistedContentFromCurrentWindow(window)
  const live = contentInstanceFromCurrentWindow(window)
  const content =
    encoded ?? (live === null && isPersistedContentEnvelope(window.content) ? window.content : null)
  if (!content) return null
  const {
    type: _type,
    source: _source,
    initialState: _initialState,
    runtimeContent: _runtimeContent,
    iconPath: _iconPath,
    iconType: _iconType,
    iconIsVirtual: _iconIsVirtual,
    content: _content,
    contentRecoveryReason: _contentRecoveryReason,
    ...host
  } = window
  return { ...host, content }
}

export function restorePersistedContentWindow(
  value: unknown,
): (ContentWindowDefinition & Record<string, unknown>) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (!isPersistedContentEnvelope(raw.content)) return null
  if (hasDisallowedPersistedContentFields(raw)) return null
  const restored = currentWindowFromPersistedContent(raw.content, {
    id: raw.id,
    title: raw.title,
  })
  const title = typeof raw.title === 'string' ? raw.title : raw.id
  if (!restored.ok) {
    return {
      ...raw,
      id: raw.id,
      title,
      type: 'viewer',
      source: { kind: 'local', rootPath: null },
      initialState: {},
      content: raw.content,
      contentRecoveryReason: restored.reason,
    } as ContentWindowDefinition & Record<string, unknown>
  }
  return {
    ...raw,
    ...restored.projection,
    id: raw.id,
    title,
    content: raw.content,
  } as ContentWindowDefinition & Record<string, unknown>
}
