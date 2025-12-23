import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Checks if a path is within an editable folder (client-side version)
 * @param relativePath Path to check
 * @param editableFolders Array of editable folder paths
 * @returns true if the path is within an editable folder
 */
export function isPathEditable(relativePath: string, editableFolders: string[]): boolean {
  if (editableFolders.length === 0) return false

  const normalizedPath = relativePath.replace(/\\/g, '/')
  return editableFolders.some((folder) => {
    const normalizedFolder = folder.replace(/\\/g, '/')
    return (
      normalizedPath === normalizedFolder ||
      normalizedPath.startsWith(normalizedFolder + '/') ||
      normalizedPath.startsWith(normalizedFolder + '\\')
    )
  })
}
