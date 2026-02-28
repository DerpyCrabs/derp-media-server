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
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + '/')
  })
}

/**
 * Returns the knowledge base root path if the given file path is inside a knowledge base.
 * @param filePath Path to check (relative to mediaDir)
 * @param knowledgeBases Array of knowledge base folder paths
 * @returns The KB root path or null if not inside any knowledge base
 */
export function getKnowledgeBaseRoot(filePath: string, knowledgeBases: string[]): string | null {
  if (knowledgeBases.length === 0) return null

  const normalizedPath = filePath.replace(/\\/g, '/')
  for (const kb of knowledgeBases) {
    const normalizedKb = kb.replace(/\\/g, '/')
    if (normalizedPath === normalizedKb || normalizedPath.startsWith(normalizedKb + '/')) {
      return normalizedKb
    }
  }
  return null
}
