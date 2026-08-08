const markdownImageExtension = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i

export function getKnowledgeBaseRootForPath(
  filePath: string,
  knowledgeBases: string[],
): string | null {
  if (knowledgeBases.length === 0) return null
  const normalized = filePath.replace(/\\/g, '/')
  for (const kb of knowledgeBases) {
    const normalizedKb = kb.replace(/\\/g, '/')
    if (normalized === normalizedKb || normalized.startsWith(normalizedKb + '/')) {
      return normalizedKb
    }
  }
  return null
}

export function isKnowledgeBaseImagePath(
  requestedPath: string,
  sharePath: string,
  knowledgeBases: string[],
): boolean {
  const normalized = requestedPath.replace(/\\/g, '/')
  if (normalized.includes('..')) return false
  const kbRoot = getKnowledgeBaseRootForPath(sharePath, knowledgeBases)
  if (!kbRoot) return false
  const imagesDir = `${kbRoot.replace(/\\/g, '/')}/images/`
  if (!normalized.startsWith(imagesDir)) return false
  const relativeToImages = normalized.slice(imagesDir.length)
  return (
    relativeToImages.length > 0 &&
    !relativeToImages.includes('/') &&
    !relativeToImages.includes('\\') &&
    markdownImageExtension.test(relativeToImages)
  )
}
