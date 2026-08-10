export const RECENT_OWNER_LOCATIONS_KEY = 'derp-desk-recent-owner-locations-v1'

export type RecentOwnerLocation = {
  kind: 'library' | 'workspace' | 'canvas'
  href: string
  label: string
  visitedAt: number
}

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'getItem' | 'setItem'>

function parseLocation(value: unknown): RecentOwnerLocation | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<RecentOwnerLocation>
  if (
    (item.kind !== 'library' && item.kind !== 'workspace' && item.kind !== 'canvas') ||
    typeof item.href !== 'string' ||
    !item.href.startsWith('/') ||
    item.href.startsWith('//') ||
    typeof item.label !== 'string' ||
    !item.label.trim() ||
    typeof item.visitedAt !== 'number' ||
    !Number.isSafeInteger(item.visitedAt) ||
    item.visitedAt < 0
  ) {
    return null
  }
  return { ...item, label: item.label.trim().slice(0, 120) } as RecentOwnerLocation
}

export function readRecentOwnerLocations(storage: StorageReader): RecentOwnerLocation[] {
  try {
    const parsed = JSON.parse(storage.getItem(RECENT_OWNER_LOCATIONS_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    const byHref = new Map<string, RecentOwnerLocation>()
    for (const value of parsed) {
      const item = parseLocation(value)
      if (!item) continue
      const current = byHref.get(item.href)
      if (!current || item.visitedAt > current.visitedAt) byHref.set(item.href, item)
    }
    return [...byHref.values()].sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 12)
  } catch {
    return []
  }
}

export function recordRecentOwnerLocation(
  storage: StorageWriter,
  location: Omit<RecentOwnerLocation, 'visitedAt'>,
  visitedAt = Date.now(),
): RecentOwnerLocation[] {
  const next = [
    { ...location, visitedAt },
    ...readRecentOwnerLocations(storage).filter((item) => item.href !== location.href),
  ].slice(0, 12)
  try {
    storage.setItem(RECENT_OWNER_LOCATIONS_KEY, JSON.stringify(next))
  } catch {}
  return next
}

export function recentLocationFromUrl(url: URL): Omit<RecentOwnerLocation, 'visitedAt'> | null {
  if (url.pathname === '/' || url.pathname === '/library') {
    const params = new URLSearchParams(url.search)
    const dir = params.get('dir') ?? params.get('path') ?? ''
    const clean = new URLSearchParams()
    if (dir) clean.set('dir', dir)
    if (params.get('offline') === '1') clean.set('offline', '1')
    const suffix = clean.toString()
    return {
      kind: 'library',
      href: `/library${suffix ? `?${suffix}` : ''}`,
      label: dir ? dir.split(/[/\\]/).filter(Boolean).at(-1) || 'Library' : 'Library',
    }
  }
  if (url.pathname === '/workspace') {
    const session = url.searchParams.get('ws')
    return {
      kind: 'workspace',
      href: `${url.pathname}${url.search}`,
      label: session ? `Workspace ${session}` : 'Workspace',
    }
  }
  if (url.pathname === '/canvas') {
    return { kind: 'canvas', href: `${url.pathname}${url.search}`, label: 'Canvas' }
  }
  return null
}
