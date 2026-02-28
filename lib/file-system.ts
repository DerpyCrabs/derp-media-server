import { promises as fs } from 'fs'
import path from 'path'
import { FileItem, MediaType } from './types'
import { getMediaType } from './media-utils'
import { VIRTUAL_FOLDERS } from './constants'
import { config } from './config'

// Re-export VIRTUAL_FOLDERS for convenience
export { VIRTUAL_FOLDERS }

// Folders to exclude from listing
const EXCLUDED_FOLDERS = [
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.DS_Store',
]

/**
 * Checks if a folder should be excluded from listing
 */
export function shouldExcludeFolder(folderName: string): boolean {
  // Exclude hidden folders (starting with .)
  if (folderName.startsWith('.')) {
    return true
  }
  // Exclude common system and build folders
  return EXCLUDED_FOLDERS.includes(folderName)
}

/**
 * Validates and resolves a path to ensure it's within MEDIA_DIR
 * Prevents path traversal attacks
 */
export function validatePath(relativePath: string): string {
  const mediaDir = config.mediaDir
  // Convert URL-style forward slashes to platform-specific separators
  const platformPath = relativePath.replace(/\//g, path.sep)

  // Normalize and resolve the path
  const normalizedPath = path.normalize(platformPath).replace(/^(\.\.(\/|\\|$))+/, '')
  const fullPath = path.join(mediaDir, normalizedPath)

  // Ensure the resolved path is within mediaDir
  const resolvedPath = path.resolve(fullPath)
  const resolvedMediaDir = path.resolve(mediaDir)

  if (!resolvedPath.startsWith(resolvedMediaDir)) {
    throw new Error('Invalid path: Path traversal detected')
  }

  return resolvedPath
}

/**
 * Gets the media directory from config
 */
export function getMediaDir(): string {
  return config.mediaDir
}

/**
 * Lists files and folders in a directory
 * @param relativePath Path relative to media directory (empty string for root)
 * @returns Array of FileItem objects
 */
export async function listDirectory(relativePath: string = ''): Promise<FileItem[]> {
  try {
    const mediaDir = config.mediaDir
    const fullPath = validatePath(relativePath)

    // Check if path exists and is a directory
    const stats = await fs.stat(fullPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    const fileItems: FileItem[] = []

    // Add virtual folders at root level
    if (relativePath === '' || relativePath === '.') {
      fileItems.push({
        name: 'Favorites',
        path: VIRTUAL_FOLDERS.FAVORITES,
        type: MediaType.FOLDER,
        size: 0,
        extension: '',
        isDirectory: true,
        isVirtual: true,
      })
      fileItems.push({
        name: 'Most Played',
        path: VIRTUAL_FOLDERS.MOST_PLAYED,
        type: MediaType.FOLDER,
        size: 0,
        extension: '',
        isDirectory: true,
        isVirtual: true,
      })
      fileItems.push({
        name: 'Shares',
        path: VIRTUAL_FOLDERS.SHARES,
        type: MediaType.FOLDER,
        size: 0,
        extension: '',
        isDirectory: true,
        isVirtual: true,
      })
    }

    for (const entry of entries) {
      try {
        // Skip excluded folders
        if (entry.isDirectory() && shouldExcludeFolder(entry.name)) {
          continue
        }

        const entryPath = path.join(fullPath, entry.name)
        const stats = await fs.stat(entryPath)
        const extension = path.extname(entry.name).slice(1).toLowerCase()

        // Get relative path from media directory
        const relPath = path.relative(mediaDir, entryPath).replace(/\\/g, '/')

        // Include directories and all files
        if (entry.isDirectory()) {
          fileItems.push({
            name: entry.name,
            path: relPath,
            type: MediaType.FOLDER,
            size: 0,
            extension: '',
            isDirectory: true,
          })
        } else {
          fileItems.push({
            name: entry.name,
            path: relPath,
            type: getMediaType(extension),
            size: stats.size,
            extension,
            isDirectory: false,
          })
        }
      } catch (error) {
        // Skip files that can't be accessed
        console.error(`Error accessing ${entry.name}:`, error)
        continue
      }
    }

    // Sort: virtual folders first, then directories, then files, then by name
    fileItems.sort((a, b) => {
      // Virtual folders always come first
      if (a.isVirtual && !b.isVirtual) return -1
      if (!a.isVirtual && b.isVirtual) return 1

      // Then regular directories
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      // Then sort by name
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })

    return fileItems
  } catch (error) {
    console.error('Error listing directory:', error)
    throw error
  }
}

/**
 * Checks if a file exists and is within MEDIA_DIR
 */
export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const fullPath = validatePath(relativePath)
    await fs.access(fullPath)
    return true
  } catch {
    return false
  }
}

/**
 * Gets the full path for a file (for streaming)
 */
export function getFilePath(relativePath: string): string {
  return validatePath(relativePath)
}

/**
 * Checks if a path is within an editable folder
 */
export function isPathEditable(relativePath: string): boolean {
  const editableFolders = config.editableFolders
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

/**
 * Gets the list of editable folders
 */
export function getEditableFolders(): string[] {
  return config.editableFolders
}

/**
 * Creates a new directory
 */
export async function createDirectory(relativePath: string): Promise<void> {
  const fullPath = validatePath(relativePath)

  // Check if parent directory is editable
  const parentPath = path.dirname(relativePath).replace(/\\/g, '/')
  if (!isPathEditable(parentPath) && !isPathEditable(relativePath)) {
    throw new Error('Cannot create directory: Path is not in an editable folder')
  }

  await fs.mkdir(fullPath, { recursive: true })
}

/**
 * Writes content to a file (creates or updates)
 */
export async function writeFile(relativePath: string, content: string): Promise<void> {
  const fullPath = validatePath(relativePath)

  // Check if path is editable
  const dirPath = path.dirname(relativePath).replace(/\\/g, '/')
  if (!isPathEditable(dirPath) && !isPathEditable(relativePath)) {
    throw new Error('Cannot write file: Path is not in an editable folder')
  }

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, content, 'utf-8')
}

/**
 * Writes binary content (base64 encoded) to a file
 */
export async function writeBinaryFile(relativePath: string, base64Content: string): Promise<void> {
  const fullPath = validatePath(relativePath)

  // Check if path is editable
  const dirPath = path.dirname(relativePath).replace(/\\/g, '/')
  if (!isPathEditable(dirPath) && !isPathEditable(relativePath)) {
    throw new Error('Cannot write file: Path is not in an editable folder')
  }

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true })

  // Convert base64 to buffer and write
  const buffer = Buffer.from(base64Content, 'base64')
  await fs.writeFile(fullPath, buffer)
}

/**
 * Reads file content as text
 */
export async function readFileContent(relativePath: string): Promise<string> {
  const fullPath = validatePath(relativePath)
  return await fs.readFile(fullPath, 'utf-8')
}

/**
 * Deletes an empty directory
 */
export async function deleteDirectory(relativePath: string): Promise<void> {
  const fullPath = validatePath(relativePath)

  // Check if path is editable
  if (!isPathEditable(relativePath)) {
    throw new Error('Cannot delete directory: Path is not in an editable folder')
  }

  // Check if it's a directory
  const stats = await fs.stat(fullPath)
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  // Check if directory is empty
  const entries = await fs.readdir(fullPath)
  if (entries.length > 0) {
    throw new Error('Cannot delete directory: Directory is not empty')
  }

  // Delete the empty directory
  await fs.rmdir(fullPath)
}

/**
 * Deletes a file
 */
export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = validatePath(relativePath)

  // Check if path is editable
  if (!isPathEditable(relativePath)) {
    throw new Error('Cannot delete file: Path is not in an editable folder')
  }

  // Check if it's a file (not a directory)
  const stats = await fs.stat(fullPath)
  if (stats.isDirectory()) {
    throw new Error('Path is a directory, not a file')
  }

  // Delete the file
  await fs.unlink(fullPath)
}

/**
 * Renames a file or directory
 */
export async function renameFileOrDirectory(
  oldRelativePath: string,
  newRelativePath: string,
): Promise<void> {
  const oldFullPath = validatePath(oldRelativePath)
  const newFullPath = validatePath(newRelativePath)

  // Check if both paths are editable
  if (!isPathEditable(oldRelativePath)) {
    throw new Error('Cannot rename: Source path is not in an editable folder')
  }
  if (!isPathEditable(newRelativePath)) {
    throw new Error('Cannot rename: Destination path is not in an editable folder')
  }

  // Check if old path exists
  const exists = await fileExists(oldRelativePath)
  if (!exists) {
    throw new Error('Source file or directory does not exist')
  }

  // Check if new path already exists
  const newExists = await fileExists(newRelativePath)
  if (newExists) {
    throw new Error('Destination file or directory already exists')
  }

  // Rename the file or directory
  await fs.rename(oldFullPath, newFullPath)
}
