import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/file-search'
import { OWNER_OPEN_SCOPE, resourceForFileItem } from '../lib/legacy-resource-adapter'
import { openResource } from '../lib/open-resource'
import { hrefFor, type RouteQuery } from '../lib/routes'

export function ownerSearchResultHref(result: FileSearchResult): string {
  const file = fileSearchResultToFileItem(result)
  const plan = openResource(resourceForFileItem(file), 'default', {
    surface: 'library',
    scope: OWNER_OPEN_SCOPE,
  })
  const query: RouteQuery = result.parentPath ? { dir: result.parentPath } : {}
  if (plan.kind === 'browse') query.dir = result.path
  else if (plan.kind === 'playback') query.playing = result.path
  else if (plan.kind === 'viewer') {
    query.viewing = result.path
    query.extra = [['viewer', plan.viewer.id]]
  }
  return hrefFor({ kind: 'library' }, query)
}
