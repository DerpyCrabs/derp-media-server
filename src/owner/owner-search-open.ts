import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/file-search'
import { OWNER_OPEN_SCOPE, resourceForFileItem } from '../lib/legacy-resource-adapter'
import { executeOpenPlan, openResource } from '../lib/open-resource'
import { hrefFor, type RouteQuery } from '../lib/routes'

function planOwnerSearchResult(result: FileSearchResult) {
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
  return { href: hrefFor({ kind: 'library' }, query), plan }
}

export function ownerSearchResultHref(result: FileSearchResult): string {
  return planOwnerSearchResult(result).href
}

export function executeOwnerSearchResult(
  result: FileSearchResult,
  navigate: (href: string) => void,
): void {
  const { href, plan } = planOwnerSearchResult(result)
  executeOpenPlan(plan, () => navigate(href))
}
