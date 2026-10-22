import type { FileOpenTarget } from '@/lib/models/open-target'
import { clientPreferencesStore } from '@/workspace/shared/client-preferences-store'

export type { FileOpenTarget } from '@/lib/models/open-target'

export const fileOpenTargetStore = {
  source: clientPreferencesStore.source,
  setTarget: clientPreferencesStore.setFileOpenTarget,
}

export function getFileOpenTarget(): FileOpenTarget {
  return clientPreferencesStore.read().fileOpenTarget
}
