export type VirtualAppearance = {
  icon: string
  tone: string
  color?: string
}

export function virtualAppearanceForPath(path: string): VirtualAppearance | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === 'Hermes Sessions') return { icon: 'agent-directory', tone: 'violet' }
  if (normalized === 'Hermes Sessions/archived') return { icon: 'archive', tone: 'muted' }
  if (normalized.startsWith('Hermes Sessions/project/')) return { icon: 'project', tone: 'indigo' }
  if (
    normalized.startsWith('Hermes Sessions/session/') ||
    normalized.startsWith('Hermes Sessions/draft/')
  ) {
    return { icon: 'agent-session', tone: 'violet' }
  }
  return undefined
}
