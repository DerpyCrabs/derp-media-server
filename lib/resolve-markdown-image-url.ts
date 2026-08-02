import { getKnowledgeBaseRoot } from '@/lib/utils'

/** Matches share / text viewer context shape for markdown image resolution. */
export type MarkdownImageShareContext = {
  token: string
  sharePath: string
  isDirectory: boolean
}

function normalizeMediaPath(value: string): string | null {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.join('/')
}

function decodeUrlPath(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function mediaPathDirname(value: string): string {
  const slash = value.lastIndexOf('/')
  return slash < 0 ? '' : value.slice(0, slash)
}

function pathIsWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function directChildOf(path: string, directory: string): boolean {
  const prefix = directory ? `${directory}/` : ''
  if (!path.startsWith(prefix)) return false
  const relative = path.slice(prefix.length)
  return relative.length > 0 && !relative.includes('/')
}

const sharedMarkdownImageExtension = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i

function directImageChildOf(path: string, directory: string): boolean {
  return directChildOf(path, directory) && sharedMarkdownImageExtension.test(path)
}

function encodeMediaPath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

function usesKnowledgeBaseImageRoute(
  viewingPath: string,
  share: MarkdownImageShareContext,
  knowledgeBases: string[],
  requestPath: string,
): boolean {
  if (!share.isDirectory) return false
  const normalizedView = normalizeMediaPath(viewingPath)
  const shareRoot = normalizeMediaPath(share.sharePath)
  const kbRootRaw = normalizedView && getKnowledgeBaseRoot(normalizedView, knowledgeBases)
  const kbRoot = kbRootRaw ? normalizeMediaPath(kbRootRaw) : null
  return Boolean(
    shareRoot &&
    kbRoot &&
    directImageChildOf(requestPath, `${kbRoot}/images`) &&
    !pathIsWithin(requestPath, shareRoot),
  )
}

export function resolveMarkdownImageSharePath(
  viewingPath: string,
  share: MarkdownImageShareContext,
  knowledgeBases: string[],
  rawSrc: string,
): string | null {
  if (/^https?:\/\//i.test(rawSrc)) return null
  let src = decodeUrlPath(rawSrc)
  if (src === null || /^https?:\/\//i.test(src)) return null

  const normView = normalizeMediaPath(viewingPath)
  const shareRoot = normalizeMediaPath(share.sharePath)
  if (normView === null || shareRoot === null) return null
  const kbRootRaw = getKnowledgeBaseRoot(normView, knowledgeBases)
  const kbRoot = kbRootRaw ? normalizeMediaPath(kbRootRaw) : null

  if (!src.startsWith('/') && !src.includes('/') && kbRoot) {
    src = `${kbRoot}/images/${src}`
  }

  const fileDir = mediaPathDirname(normView)
  const firstSeg = (value: string) => value.split('/').filter(Boolean)[0] ?? ''
  const isAbsolute =
    src.startsWith('/') ||
    (fileDir && pathIsWithin(src, fileDir)) ||
    (shareRoot && pathIsWithin(src, shareRoot)) ||
    (firstSeg(src) && firstSeg(src) === firstSeg(normView))
  const resolvedPath = normalizeMediaPath(
    isAbsolute
      ? src.startsWith('/')
        ? src.slice(1)
        : src
      : `${fileDir ? `${fileDir}/` : ''}${src}`,
  )
  if (!resolvedPath) return null

  const kbImage = kbRoot ? directImageChildOf(resolvedPath, `${kbRoot}/images`) : false
  if (share.isDirectory) {
    if (pathIsWithin(resolvedPath, shareRoot) && resolvedPath !== shareRoot) {
      return resolvedPath.slice(shareRoot.length).replace(/^\/+/, '')
    }
    return kbImage ? resolvedPath : null
  }

  const shareFileDir = mediaPathDirname(shareRoot)
  const siblingImagesDir = shareFileDir ? `${shareFileDir}/images` : 'images'
  if (
    resolvedPath !== shareRoot &&
    !kbImage &&
    !directImageChildOf(resolvedPath, shareFileDir) &&
    !directImageChildOf(resolvedPath, siblingImagesDir)
  ) {
    return null
  }
  return resolvedPath
}

/**
 * Resolves markdown image `src` to a URL for the media API (admin) or share media API.
 * Bare filenames inside a configured knowledge base are resolved under `{kbRoot}/images/`
 * (Obsidian default attachment folder).
 */
export function buildResolveMarkdownImageUrl(
  viewingPath: string,
  share: MarkdownImageShareContext | null,
  knowledgeBases: string[],
): (src: string) => string | null {
  return (rawSrc: string) => {
    if (share) {
      if (/^https?:\/\//i.test(rawSrc)) return rawSrc
      const requestPath = resolveMarkdownImageSharePath(viewingPath, share, knowledgeBases, rawSrc)
      if (!requestPath) return null
      const encoded = encodeMediaPath(requestPath)
      if (!encoded) return null
      const route = usesKnowledgeBaseImageRoute(viewingPath, share, knowledgeBases, requestPath)
        ? 'knowledge-base-image'
        : 'media'
      return `/api/share/${share.token}/${route}/${encoded}`
    }

    if (/^https?:\/\//i.test(rawSrc)) return rawSrc
    let src = decodeUrlPath(rawSrc)
    if (src === null || /^https?:\/\//i.test(src)) return null

    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.includes('/')) {
      const kbRoot = getKnowledgeBaseRoot(viewingPath.replace(/\\/g, '/'), knowledgeBases)
      if (kbRoot) {
        src = `${kbRoot}/images/${src}`
      }
    }

    return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  }
}
