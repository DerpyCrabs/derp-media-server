import { randomId } from '@/lib/random-id'

import { modelOwner, type Source } from 'effectweb'

import { type HermesMessage, type HermesChatState } from './hermes-session-types'

export const registry = modelOwner<{ sessions: Record<string, HermesChatState> }>({ sessions: {} })

export const hermesSessionsSource: Source<Record<string, HermesChatState>> = {
  model: () => registry.read().sessions,
  subscribe: (listener) => registry.source.subscribe((model) => listener(model.sessions)),
}

export const sessions = () => registry.read().sessions

export const durableSessionAliases = new Map<string, string>()

export function updateHermesState(
  key: string,
  update: (state: HermesChatState) => Partial<HermesChatState>,
) {
  const current = sessions()[key]
  if (!current) return
  patchHermesState(key, update(current))
}

export function patchHermesState(key: string, patch: Partial<HermesChatState>) {
  const current = sessions()[key]
  if (!current) return
  if (
    Object.entries(patch).every(
      ([field, value]) => current[field as keyof HermesChatState] === value,
    )
  )
    return
  registry.patch({ sessions: { ...sessions(), [key]: { ...current, ...patch } } })
}

export function updateHermesMessage(key: string, index: number, patch: Partial<HermesMessage>) {
  updateHermesState(key, (state) => ({
    messages: state.messages.map((message, at) =>
      at === index ? { ...message, ...patch } : message,
    ),
  }))
}

export function replaceHermesState(key: string, state: HermesChatState) {
  registry.patch({ sessions: { ...sessions(), [key]: state } })
}

export function removeHermesState(key: string) {
  registry.edit('sessions', (states) => {
    const next = { ...states }
    delete next[key]
    return next
  })
  for (const [alias, stableKey] of durableSessionAliases)
    if (stableKey === key) durableSessionAliases.delete(alias)
}

export function durableSessionKey(sessionId: string): string {
  return `session:${sessionId}`
}

export function stableKeyForSessionId(sessionId: string): string | undefined {
  const sessionKey = durableSessionKey(sessionId)
  const alias = durableSessionAliases.get(sessionKey)
  if (alias && sessions()[alias]) return alias
  if (alias) durableSessionAliases.delete(sessionKey)
  return sessions()[sessionKey] ? sessionKey : undefined
}

export function hermesChatKey(target: { sessionId?: string; draftId?: string }): string {
  return target.sessionId
    ? (stableKeyForSessionId(target.sessionId) ?? durableSessionKey(target.sessionId))
    : `draft:${target.draftId ?? randomId()}`
}

export function bindHermesSessionId(key: string, sessionId: string): string {
  const state = sessions()[key]
  if (!state) return key
  if (state.sessionId) durableSessionAliases.set(durableSessionKey(state.sessionId), key)
  durableSessionAliases.set(durableSessionKey(sessionId), key)
  updateHermesState(key, () => ({ sessionId: sessionId, draftId: undefined }))
  return key
}

export function hermesSessionForId(sessionId: string): HermesChatState | undefined {
  const key = stableKeyForSessionId(sessionId)
  return key ? sessions()[key] : undefined
}

export const deletedHermesSessionIds = new Set<string>()
