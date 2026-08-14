import type { ContentInstance } from '@/lib/domain/content'
import { hermesSessions } from '@/lib/hermes-session-store'
import { HERMES_PROVIDER, normalizeHermesContentState } from './hermes/module'

export type ContentLiveStatus = Readonly<{
  needsInput: boolean
  working: boolean
  failed: boolean
  unread: boolean
}>

export function applicationContentLiveStatus(
  instance: ContentInstance | undefined,
): ContentLiveStatus | null {
  if (
    instance?.type !== 'integration' ||
    instance.integration !== HERMES_PROVIDER ||
    instance.view !== 'chat'
  ) {
    return null
  }
  const content = normalizeHermesContentState(instance.state)
  const session = content?.sessionId ? hermesSessions[`session:${content.sessionId}`] : undefined
  if (!session) return null
  return {
    needsInput: !!session.decision,
    working: !session.decision && (session.status === 'sending' || session.status === 'streaming'),
    failed: session.status === 'error',
    unread: !!session.unread,
  }
}
