// Virtual folder identifiers - shared between client and server
// These are used as actual paths, so they should be display-friendly
export const VIRTUAL_FOLDERS = {
  MOST_PLAYED: 'Most Played',
  FAVORITES: 'Favorites',
  SHARES: 'Shares',
} as const

export function isVirtualFolderPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/')
  const roots = Object.values(VIRTUAL_FOLDERS) as string[]
  return roots.some((r) => norm === r || norm.startsWith(`${r}/`))
}
