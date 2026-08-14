import {
  isContentInstance,
  type ContentInstance,
  type PersistedContentEnvelope,
} from './domain/content'

export type ContentWindowKind = 'browser' | 'viewer' | 'integration'

export interface ContentWindowDefinition {
  id: string
  title: string
  iconName?: string | null
  content?: PersistedContentEnvelope
  contentInstance?: ContentInstance
  contentRecoveryReason?: string
}

export function liveContentInstance(
  window: Pick<ContentWindowDefinition, 'id' | 'contentInstance'>,
): ContentInstance | null {
  return isContentInstance(window.contentInstance) && window.contentInstance.id === window.id
    ? window.contentInstance
    : null
}

export function contentWindowKind(
  window: Pick<ContentWindowDefinition, 'id' | 'contentInstance'>,
): ContentWindowKind {
  const instance = liveContentInstance(window)
  if (instance?.type === 'explorer') return 'browser'
  if (instance?.type === 'integration') return 'integration'
  return 'viewer'
}
