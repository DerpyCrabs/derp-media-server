import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'

export type RouteKind =
  | 'login'
  | 'home'
  | 'library'
  | 'spaces'
  | 'space'
  | 'workspace'
  | 'canvas'
  | 'assistant'
  | 'offline'
  | 'settings'
  | 'share'
  | 'shareWorkspace'
  | 'notFound'

export type ReaderKind = 'pdf' | 'folder' | 'book'

export type RouteQuery = {
  dir?: string
  path?: string
  viewing?: string
  playing?: string
  reader?: string
  readerKind?: ReaderKind
  audioOnly?: boolean
  offline?: boolean
  extra?: readonly (readonly [string, string])[]
}

export type RouteLocation = {
  pathname: string
  search?: string
  hash?: string
}

type StaticRouteTarget = {
  kind: Exclude<RouteKind, 'space' | 'share' | 'shareWorkspace' | 'notFound'>
}

type SpaceRouteTarget = {
  kind: 'space'
  id: string
}

type ShareRouteTarget = {
  kind: 'share' | 'shareWorkspace'
  token: string
}

type NotFoundRouteTarget = {
  kind: 'notFound'
  pathname: string
}

export type RouteTarget =
  | StaticRouteTarget
  | SpaceRouteTarget
  | ShareRouteTarget
  | NotFoundRouteTarget

type Located<T> = T extends RouteTarget
  ? T & {
      location: Required<RouteLocation>
      query: RouteQuery
      directory: string
    }
  : never

export type AppRoute = Located<RouteTarget>

export type NavigationAdapter = {
  push(href: string): void
  replace(href: string): void
}

const STATIC_ROUTES = new Map<string, StaticRouteTarget['kind']>([
  ['/', 'library'],
  ['/library', 'library'],
  ['/home', 'home'],
  ['/spaces', 'spaces'],
  ['/workspace', 'workspace'],
  ['/canvas', 'canvas'],
  ['/assistant', 'assistant'],
  ['/offline', 'offline'],
  ['/settings', 'settings'],
  ['/login', 'login'],
])

const TARGET_PATHS: Record<StaticRouteTarget['kind'], string> = {
  login: '/login',
  home: '/home',
  library: '/',
  spaces: '/spaces',
  workspace: '/workspace',
  canvas: '/canvas',
  assistant: '/assistant',
  offline: '/offline',
  settings: '/settings',
}

const KNOWN_QUERY_KEYS = new Set([
  'dir',
  'path',
  'viewing',
  'playing',
  'reader',
  'readerKind',
  'audioOnly',
  'offline',
])

function normalizedPathname(pathname: string) {
  if (pathname === '/') return pathname
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function normalizedLocation(location: RouteLocation): Required<RouteLocation> {
  return {
    pathname: location.pathname || '/',
    search: location.search ?? '',
    hash: location.hash ?? '',
  }
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function decodeSpaceId(segment: string): string | null {
  try {
    const id = decodeURIComponent(segment)
    return id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id) ? id : null
  } catch {
    return null
  }
}

function parseQuery(search: string): RouteQuery {
  const params = new URLSearchParams(search)
  const readerKind = params.get('readerKind')
  const extra = [...params.entries()].filter(([key]) => !KNOWN_QUERY_KEYS.has(key))
  return {
    ...(params.has('dir') ? { dir: params.get('dir') ?? '' } : {}),
    ...(params.has('path') ? { path: params.get('path') ?? '' } : {}),
    ...(params.has('viewing') ? { viewing: params.get('viewing') ?? '' } : {}),
    ...(params.has('playing') ? { playing: params.get('playing') ?? '' } : {}),
    ...(params.has('reader') ? { reader: params.get('reader') ?? '' } : {}),
    ...(readerKind === 'pdf' || readerKind === 'folder' || readerKind === 'book'
      ? { readerKind }
      : {}),
    ...(params.get('audioOnly') === 'true' ? { audioOnly: true } : {}),
    ...(params.get('offline') === '1' ? { offline: true } : {}),
    ...(extra.length > 0 ? { extra } : {}),
  }
}

function located<T extends RouteTarget>(target: T, location: Required<RouteLocation>): Located<T> {
  const query = parseQuery(location.search)
  return {
    ...target,
    location,
    query,
    directory: query.dir ?? query.path ?? '',
  } as Located<T>
}

/**
 * Route Module Interface: parse one browser/server location into one exact route.
 * Unknown paths never inherit Library behaviour.
 */
export function parseRoute(input: RouteLocation): AppRoute {
  const location = normalizedLocation(input)
  const pathname = normalizedPathname(location.pathname)
  const staticKind = STATIC_ROUTES.get(pathname)
  if (staticKind) return located({ kind: staticKind }, location)

  const segments = pathname.split('/').slice(1)
  if (
    segments[0] === 'spaces' &&
    segments[1] === 'id' &&
    segments[2]?.startsWith('~') &&
    segments.length === 3
  ) {
    const id = decodeSpaceId(segments[2].slice(1))
    if (id !== null) return located({ kind: 'space', id }, location)
  }
  if (segments[0] === 'share' && segments[1]) {
    const token = decodePathSegment(segments[1])
    if (segments.length === 2) {
      return located({ kind: 'share', token }, location)
    }
    if (segments.length === 3 && segments[2] === 'workspace') {
      return located({ kind: 'shareWorkspace', token }, location)
    }
  }

  return located({ kind: 'notFound', pathname: location.pathname }, location)
}

function appendQuery(params: URLSearchParams, query: RouteQuery) {
  if (query.dir !== undefined) params.set('dir', query.dir)
  if (query.path !== undefined) params.set('path', query.path)
  if (query.viewing !== undefined) params.set('viewing', query.viewing)
  if (query.playing !== undefined) params.set('playing', query.playing)
  if (query.reader !== undefined) params.set('reader', query.reader)
  if (query.readerKind !== undefined) params.set('readerKind', query.readerKind)
  if (query.audioOnly) params.set('audioOnly', 'true')
  if (query.offline) params.set('offline', '1')
  for (const [key, value] of query.extra ?? []) params.append(key, value)
}

function targetPath(target: RouteTarget) {
  if (target.kind === 'space') {
    if (!target.id || target.id.length > 128 || /[\u0000-\u001f\u007f]/.test(target.id)) {
      throw new Error('Space ID must be a safe non-empty ID')
    }
    return `/spaces/id/~${encodeURIComponent(target.id)}`
  }
  if (target.kind === 'share' || target.kind === 'shareWorkspace') {
    if (!target.token || target.token.includes('/'))
      throw new Error('Share token must be one segment')
    const base = `/share/${encodeURIComponent(target.token)}`
    return target.kind === 'shareWorkspace' ? `${base}/workspace` : base
  }
  if (target.kind === 'notFound') return target.pathname
  return TARGET_PATHS[target.kind]
}

/** Generate canonical paths for new targets; parsed routes round-trip byte-for-byte. */
export function hrefFor(target: RouteTarget | AppRoute, query?: RouteQuery): string {
  if ('location' in target && query === undefined) {
    return `${target.location.pathname}${target.location.search}${target.location.hash}`
  }
  const params = new URLSearchParams()
  if (query) appendQuery(params, query)
  const search = params.toString()
  return `${targetPath(target)}${search ? `?${search}` : ''}`
}

export function hrefForSpace(spaceId: string, options: { history?: boolean } = {}): string {
  const href = hrefFor({ kind: 'space', id: spaceId })
  return options.history ? `${href}#history` : href
}

/** Generate a compatible Library destination that opens playable media in player chrome. */
export function hrefForLibraryFile(path: string): string {
  const mediaType = getMediaTypeFromPath(path)
  return hrefFor(
    { kind: 'library' },
    mediaType === MediaType.AUDIO || mediaType === MediaType.VIDEO
      ? { playing: path }
      : { viewing: path },
  )
}

function browserNavigation(): NavigationAdapter {
  return {
    push(href) {
      window.history.pushState(null, '', href)
      window.dispatchEvent(new Event('derp:navigation'))
    },
    replace(href) {
      window.history.replaceState(null, '', href)
      window.dispatchEvent(new Event('derp:navigation'))
    },
  }
}

function navigateHref(
  href: string,
  options: { replace?: boolean; adapter?: NavigationAdapter } = {},
) {
  const adapter = options.adapter ?? browserNavigation()
  if (options.replace) adapter.replace(href)
  else adapter.push(href)
  return href
}

export function navigateSpace(
  spaceId: string,
  options: { replace?: boolean; history?: boolean; adapter?: NavigationAdapter } = {},
) {
  return navigateHref(hrefForSpace(spaceId, options), options)
}

/** Keep ordinary same-app anchors accessible while avoiding a document navigation on plain click. */
export function followAppLink(
  event: MouseEvent,
  href: string,
  options: { replace?: boolean } = {},
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false
  }
  event.preventDefault()
  navigateHref(href, options)
  return true
}

/** Navigate through same generator used by links. Adapter keeps tests outside browser globals. */
export function navigate(
  target: RouteTarget | AppRoute,
  options: { replace?: boolean; query?: RouteQuery; adapter?: NavigationAdapter } = {},
) {
  const href = hrefFor(target, options.query)
  return navigateHref(href, options)
}
