import { modelOwner } from 'effectweb'

const DEBOUNCE_MS = 1500

const owner = modelOwner({ message: null as string | null })

let lastPushedMessage = ''
let lastPushedAt = 0

export function pushForbiddenNotice(message: string) {
  if (typeof window === 'undefined') return
  const trimmed = message.trim() || 'Forbidden'
  const now = Date.now()
  if (trimmed === lastPushedMessage && now - lastPushedAt < DEBOUNCE_MS) return
  lastPushedMessage = trimmed
  lastPushedAt = now
  owner.patch({ message: trimmed })
}

export function dismissForbiddenNotice() {
  owner.patch({ message: null })
}

export const forbiddenNoticeSource = owner.source
