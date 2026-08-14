export type AppSurface = 'library' | 'workspace' | 'canvas'
export type AppRouteKind = AppSurface | 'notFound'
export type ReaderKind = 'pdf' | 'folder' | 'book'

export type RouteQuery = {
  dir?: string
  viewing?: string
  playing?: string
  audioOnly?: boolean
  reader?: string
  readerKind?: ReaderKind
  ws?: string
  preset?: string
  extra?: readonly (readonly [string, string])[]
}

export type RouteQueryParamKey =
  | 'dir'
  | 'viewing'
  | 'playing'
  | 'audioOnly'
  | 'reader'
  | 'readerKind'
  | 'ws'
  | 'preset'

export type RouteQueryUpdates = Partial<Record<RouteQueryParamKey, string | null>>

export type RouteLocation = {
  pathname: string
  search?: string
  hash?: string
}

type LocatedRoute = {
  location: Required<RouteLocation>
  query: RouteQuery
  directory: string
}

export type AppRoute = LocatedRoute &
  (
    | { kind: AppSurface }
    | {
        kind: 'notFound'
        pathname: string
      }
  )

export type SurfaceRouteTarget = { kind: AppSurface }

const SURFACE_PATHS: Record<AppSurface, string> = {
  library: '/',
  workspace: '/workspace',
  canvas: '/canvas',
}

const PATH_SURFACES = new Map<string, AppSurface>(
  Object.entries(SURFACE_PATHS).map(([surface, pathname]) => [pathname, surface as AppSurface]),
)

const KNOWN_QUERY_KEYS = new Set<RouteQueryParamKey>([
  'dir',
  'viewing',
  'playing',
  'audioOnly',
  'reader',
  'readerKind',
  'ws',
  'preset',
])

function normalizedPathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

function prefixed(value: string | undefined, prefix: '?' | '#'): string {
  if (!value) return ''
  return value.startsWith(prefix) ? value : `${prefix}${value}`
}

function normalizedLocation(location: RouteLocation): Required<RouteLocation> {
  return {
    pathname: location.pathname || '/',
    search: prefixed(location.search, '?'),
    hash: prefixed(location.hash, '#'),
  }
}

function optionalParam(params: URLSearchParams, key: RouteQueryParamKey): string | undefined {
  return params.has(key) ? (params.get(key) ?? '') : undefined
}

function parseQuery(search: string): RouteQuery {
  const params = new URLSearchParams(search)
  const readerKind = params.get('readerKind')
  const extra = [...params.entries()].filter(
    ([key]) => !KNOWN_QUERY_KEYS.has(key as RouteQueryParamKey),
  )

  return {
    ...(params.has('dir') ? { dir: optionalParam(params, 'dir') } : {}),
    ...(params.has('viewing') ? { viewing: optionalParam(params, 'viewing') } : {}),
    ...(params.has('playing') ? { playing: optionalParam(params, 'playing') } : {}),
    ...(params.get('audioOnly') === 'true' ? { audioOnly: true } : {}),
    ...(params.has('reader') ? { reader: optionalParam(params, 'reader') } : {}),
    ...(readerKind === 'pdf' || readerKind === 'folder' || readerKind === 'book'
      ? { readerKind }
      : {}),
    ...(params.has('ws') ? { ws: optionalParam(params, 'ws') } : {}),
    ...(params.has('preset') ? { preset: optionalParam(params, 'preset') } : {}),
    ...(extra.length > 0 ? { extra } : {}),
  }
}

function locationHref(location: Required<RouteLocation>): string {
  return `${location.pathname}${location.search}${location.hash}`
}

export function parseRoute(input: RouteLocation): AppRoute {
  const location = normalizedLocation(input)
  const query = parseQuery(location.search)
  const surface = PATH_SURFACES.get(normalizedPathname(location.pathname))
  const located = {
    location,
    query,
    directory: query.dir ?? '',
  }

  return surface
    ? { ...located, kind: surface }
    : { ...located, kind: 'notFound', pathname: location.pathname }
}

function appendQuery(params: URLSearchParams, query: RouteQuery): void {
  if (query.dir !== undefined) params.set('dir', query.dir)
  if (query.viewing !== undefined) params.set('viewing', query.viewing)
  if (query.playing !== undefined) params.set('playing', query.playing)
  if (query.audioOnly) params.set('audioOnly', 'true')
  if (query.reader !== undefined) params.set('reader', query.reader)
  if (query.readerKind !== undefined) params.set('readerKind', query.readerKind)
  if (query.ws !== undefined) params.set('ws', query.ws)
  if (query.preset !== undefined) params.set('preset', query.preset)
  for (const [key, value] of query.extra ?? []) params.append(key, value)
}

export function hrefFor(target: SurfaceRouteTarget | AppRoute, query?: RouteQuery): string {
  if ('location' in target && query === undefined) return locationHref(target.location)
  if (target.kind === 'notFound') return locationHref(target.location)

  const params = new URLSearchParams()
  if (query) appendQuery(params, query)
  const search = params.toString()
  return `${SURFACE_PATHS[target.kind]}${search ? `?${search}` : ''}`
}

export function hrefForSurface(surface: AppSurface, current?: AppRoute): string {
  if (current?.kind === surface) return hrefFor(current)
  const dir = current?.query.dir
  const query = surface === 'canvas' || dir === undefined ? undefined : { dir }
  return hrefFor({ kind: surface }, query)
}

export function updateRouteSearch(input: RouteLocation, updates: RouteQueryUpdates): string {
  const location = normalizedLocation(input)
  const params = new URLSearchParams(location.search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key)
    else if (value !== undefined) params.set(key, value)
  }
  const search = params.toString()
  return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`
}
