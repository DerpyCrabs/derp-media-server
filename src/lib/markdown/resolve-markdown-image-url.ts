import { getKnowledgeBaseRoot } from '@/lib/files/path-utils'

function decodeUrlPath(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Resolve markdown image references through the media API. */
export function buildResolveMarkdownImageUrl(
  viewingPath: string,
  knowledgeBases: string[],
): (src: string) => string | null {
  const kbRoot = getKnowledgeBaseRoot(viewingPath.replace(/\\/g, '/'), knowledgeBases)
  return (rawSrc: string) => {
    if (/^https?:\/\//i.test(rawSrc)) return rawSrc
    let src = decodeUrlPath(rawSrc)
    if (src === null || /^https?:\/\//i.test(src)) return null

    if (!src.startsWith('/') && !src.includes('/')) {
      if (kbRoot) src = `${kbRoot}/images/${src}`
    }

    return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  }
}
