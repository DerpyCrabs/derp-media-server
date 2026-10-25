import { Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { readPersistedState, writePersistedState } from '@/lib/state/client-store-utils'

const key = 'file-browser-preferences'
const schema = Schema.Struct({ showHidden: Schema.Boolean })
const owner = modelOwner(readPersistedState(key, schema) ?? { showHidden: false })
export const browserPreferences = {
  read: owner.read,
  source: owner.source,
  toggleHidden: () => {
    const next = { showHidden: !owner.read().showHidden }
    owner.patch(next)
    writePersistedState(key, next)
  },
}
