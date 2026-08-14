import { filesystemResourceKey } from '../../lib/domain/resource'

type Surface = 'library' | 'workspace' | 'canvas'
type QueryValue = string | number | boolean | null | undefined

const SURFACE_PATH: Record<Surface, string> = {
  library: '/',
  workspace: '/workspace',
  canvas: '/canvas',
}

function filesystemLocation(path: string) {
  if (path === 'Favorites') return filesystemResourceKey('application-collections', 'favorites')
  if (path === 'Most Played') {
    return filesystemResourceKey('application-collections', 'most-played')
  }
  return filesystemResourceKey('configured-default', path)
}

export function surfaceUrl(
  surface: Surface,
  path = '',
  query: Readonly<Record<string, QueryValue>> = {},
): string {
  const location = filesystemLocation(path)
  const params = new URLSearchParams({ provider: location.provider, resource: location.id })
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== false) params.set(key, String(value))
  }
  return `${SURFACE_PATH[surface]}?${params}`
}

export function libraryUrl(path = '', query: Readonly<Record<string, QueryValue>> = {}): string {
  return surfaceUrl('library', path, query)
}

export function workspaceUrl(path = '', query: Readonly<Record<string, QueryValue>> = {}): string {
  return surfaceUrl('workspace', path, query)
}
