import { getKnowledgeBaseRoot } from '@/lib/utils'

/** Matches share / text viewer context shape for markdown image resolution. */
export type MarkdownImageShareContext = {
  token: string
  sharePath: string
  isDirectory: boolean
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
    let src = rawSrc
    try {
      src = decodeURIComponent(src)
    } catch {
      /* noop */
    }

    if (share) {
      if (src.startsWith('http://') || src.startsWith('https://')) return src
      const normView = viewingPath.replace(/\\/g, '/')
      // Bare filename in a KB note → vault `images/` (same as admin `/api/media` path).
      if (!src.startsWith('/') && !src.includes('/')) {
        const kbRoot = getKnowledgeBaseRoot(normView, knowledgeBases)
        if (kbRoot) {
          src = `${kbRoot}/images/${src}`
        }
      }
      const fileDir = normView.replace(/\/[^/]*$/, '')
      const shareRoot = share.sharePath.replace(/\\/g, '/')
      const firstSeg = (p: string) => p.split('/').filter(Boolean)[0] ?? ''
      const isAbsolute =
        src.startsWith('/') ||
        (fileDir && (src === fileDir || src.startsWith(fileDir + '/'))) ||
        (shareRoot && (src === shareRoot || src.startsWith(shareRoot + '/'))) ||
        (firstSeg(src) && firstSeg(src) === firstSeg(normView))
      let resolvedPath = isAbsolute
        ? src.startsWith('/')
          ? src.slice(1)
          : src
        : `${fileDir ? fileDir + '/' : ''}${src}`.replace(/\/+/g, '/').replace(/^\/+/, '')
      if (share.isDirectory && shareRoot && resolvedPath.startsWith(shareRoot + '/')) {
        resolvedPath = resolvedPath.slice(shareRoot.length).replace(/^\/+/, '')
      } else if (share.isDirectory && shareRoot && resolvedPath === shareRoot) {
        return null
      } else if (!share.isDirectory && resolvedPath !== shareRoot) {
        return null
      }
      const encoded = resolvedPath
        .split('/')
        .filter(Boolean)
        .map((s) => encodeURIComponent(s))
        .join('/')
      return encoded ? `/api/share/${share.token}/media/${encoded}` : null
    }

    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.includes('/')) {
      const kbRoot = getKnowledgeBaseRoot(viewingPath.replace(/\\/g, '/'), knowledgeBases)
      if (kbRoot) {
        src = `${kbRoot}/images/${src}`
      }
    }

    return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  }
}
