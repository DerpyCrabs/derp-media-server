import { createStore } from 'solid-js/store'
import { createStoreListeners } from './client-store-utils'

const DEBOUNCE_MS = 1500

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  message: null as string | null,
})

let lastPushedMessage = ''
let lastPushedAt = 0

export function pushForbiddenNotice(message: string) {
  if (typeof window === 'undefined') return
  const trimmed = message.trim() || 'Forbidden'
  const now = Date.now()
  if (trimmed === lastPushedMessage && now - lastPushedAt < DEBOUNCE_MS) return
  lastPushedMessage = trimmed
  lastPushedAt = now
  setStore('message', trimmed)
  listeners.notify()
}

export function dismissForbiddenNotice() {
  setStore('message', null)
  listeners.notify()
}

export const useForbiddenNotifyStore = {
  getState: () => ({
    get message() {
      return store.message
    },
  }),
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
