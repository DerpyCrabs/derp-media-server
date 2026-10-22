import { available, modelOwner } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { mediaAiStatusQuery } from './queries'
import { observeQuery } from '@effectweb/query'
const owner = modelOwner({ enabled: false })
export const musicStatusSource = owner.source
export function initializeMusicStatus() {
  const status = observeQuery(owner, queryCache, mediaAiStatusQuery, (result) =>
    owner.patch({ enabled: available(result)?.enabled === true }),
  )
  status.select(true)
  return { dispose: owner.dispose, close: owner.close }
}
