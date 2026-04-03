import { getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'

export class KbFsPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KbFsPathError'
  }
}

function normalizeKbKey(kbRoot: string): string {
  return kbRoot.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * KB-relative path segments for tools (forward slashes, relative to KB root).
 * Rejects traversal and absolute-style paths.
 */
export function assertKbRelativePathSafe(kbRelative: string): void {
  const rel = kbRelative.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel === '' || rel === '.') return
  const segments = rel.split('/').filter(Boolean)
  for (const seg of segments) {
    if (seg === '..') {
      throw new KbFsPathError('Path must not contain ".."')
    }
  }
}

/**
 * Maps a path relative to the KB root to a path relative to the media library root.
 */
export function kbRelativeToMediaPath(kbRoot: string, kbRelative: string): string {
  const kb = normalizeKbKey(kbRoot)
  if (!kb) throw new KbFsPathError('Invalid knowledge base root')

  let rel = kbRelative.replace(/\\/g, '/').replace(/^\/+/, '')
  assertKbRelativePathSafe(rel)

  // Models often repeat the KB folder name (they see "Notes" in media links and pass "Notes/Logs"
  // even though paths are already KB-root-relative). Strip one mistaken leading "kb/" segment.
  if (rel.startsWith(`${kb}/`)) {
    rel = rel.slice(kb.length + 1)
    assertKbRelativePathSafe(rel)
  }

  const mediaPath = rel ? `${kb}/${rel}` : kb
  const resolvedKb = getKnowledgeBaseRootForPath(mediaPath, [kb])
  if (resolvedKb !== kb) {
    throw new KbFsPathError('Path escapes knowledge base root')
  }
  return mediaPath.replace(/\\/g, '/')
}

/**
 * Strips KB root prefix for display / tool output (KB-relative path).
 */
export function mediaPathToKbRelative(kbRoot: string, mediaPath: string): string {
  const kb = normalizeKbKey(kbRoot)
  const m = mediaPath.replace(/\\/g, '/')
  if (m === kb) return ''
  if (m.startsWith(kb + '/')) return m.slice(kb.length + 1)
  throw new KbFsPathError('Path is not under this knowledge base')
}

/**
 * Normalizes a model-supplied KB-relative path for display and prompts.
 * Collapses mistaken repeated "{kb}/{kb}/" segments (common when the model echoes the library folder name).
 */
export function canonicalKbRelativePath(kbRoot: string, kbRelative: string): string {
  const kb = normalizeKbKey(kbRoot)
  let media = kbRelativeToMediaPath(kbRoot, kbRelative)
  const dupPrefix = `${kb}/${kb}/`
  while (media.startsWith(dupPrefix)) {
    media = kb + '/' + media.slice(dupPrefix.length)
  }
  return mediaPathToKbRelative(kbRoot, media)
}
