export interface SourceContext {
  shareToken?: string | null
  sharePath?: string | null
}

export function resolveSourceContext(
  sourceOrToken?: SourceContext | string | null,
  sharePath?: string | null,
): SourceContext {
  if (typeof sourceOrToken === 'string' || sourceOrToken == null || sharePath !== undefined) {
    return {
      shareToken: typeof sourceOrToken === 'string' ? sourceOrToken : null,
      sharePath: sharePath ?? null,
    }
  }

  return sourceOrToken ?? {}
}

export function stripSharePrefix(filePath: string, sharePath: string | null | undefined): string {
  if (!sharePath) return filePath
  const norm = filePath.replace(/\\/g, '/')
  const base = sharePath.replace(/\\/g, '/')
  if (norm === base) return ''
  return norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm
}
