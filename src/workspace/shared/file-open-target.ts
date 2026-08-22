import type { FileOpenTarget } from '@/lib/models/open-target'
import { clientPreferencesStore } from '@/workspace/shared/client-preferences-store'

export type { FileOpenTarget } from '@/lib/models/open-target'

const api = {
  get target() {
    return clientPreferencesStore.getState().fileOpenTarget
  },
  setTarget(value: FileOpenTarget) {
    clientPreferencesStore.getState().setFileOpenTarget(value)
  },
}

export const fileOpenTargetStore = {
  getState: () => api,
  subscribe: clientPreferencesStore.subscribe,
}

/** Non-reactive workspace preference read for event handlers. */
export function getFileOpenTarget(): FileOpenTarget {
  return fileOpenTargetStore.getState().target
}
