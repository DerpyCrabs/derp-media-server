export type FolderHistory = Readonly<{ entries: readonly string[]; index: number }>
export const initialFolderHistory = (path: string): FolderHistory => ({ entries: [path], index: 0 })
export function visitFolder(history: FolderHistory, path: string): FolderHistory {
  if (history.entries[history.index] === path) return history
  const entries = [...history.entries.slice(0, history.index + 1), path].slice(-100)
  return { entries, index: entries.length - 1 }
}
export function folderHistoryTarget(history: FolderHistory, direction: -1 | 1) {
  const index = history.index + direction
  const path = history.entries[index]
  return path === undefined ? undefined : { index, path }
}
