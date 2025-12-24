import { promises as fs } from 'fs'
import path from 'path'
import { FileItem, MediaType } from './types'
import { getMediaType } from './media-utils'

const MEDIA_DIR = process.env.MEDIA_DIR || process.cwd()
const EDITABLE_FOLDERS = process.env.EDITABLE_FOLDERS
  ? process.env.EDITABLE_FOLDERS.split(',').map((f) => f.trim())
  : []

/**
 * Validates and resolves a path to ensure it's within MEDIA_DIR
 * Prevents path traversal attacks
 */
export function validatePath(relativePath: string): string {
  // Convert URL-style forward slashes to platform-specific separators
  const platformPath = relativePath.replace(/\//g, path.sep)

  // Normalize and resolve the path
  const normalizedPath = path.normalize(platformPath).replace(/^(\.\.(\/|\\|$))+/, '')
  const fullPath = path.join(MEDIA_DIR, normalizedPath)

  // Ensure the resolved path is within MEDIA_DIR
  const resolvedPath = path.resolve(fullPath)
  const resolvedMediaDir = path.resolve(MEDIA_DIR)

  if (!resolvedPath.startsWith(resolvedMediaDir)) {
    throw new Error('Invalid path: Path traversal detected')
  }

  return resolvedPath
}

/**
 * Gets the media directory from environment variable
 */
export function getMediaDir(): string {
  if (!process.env.MEDIA_DIR) {
    console.warn('MEDIA_DIR not set, using current working directory')
  }
  return MEDIA_DIR
}

/**
 * Lists files and folders in a directory
 * @param relativePath Path relative to MEDIA_DIR (empty string for root)
 * @returns Array of FileItem objects
 */
export async function listDirectory(relativePath: string = ''): Promise<FileItem[]> {
  try {
    const fullPath = validatePath(relativePath)

    // Check if path exists and is a directory
    const stats = await fs.stat(fullPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    const fileItems: FileItem[] = []

    for (const entry of entries) {
      try {
        const entryPath = path.join(fullPath, entry.name)
        const stats = await fs.stat(entryPath)
        const extension = path.extname(entry.name).slice(1).toLowerCase()

        // Get relative path from MEDIA_DIR
        const relPath = path.relative(MEDIA_DIR, entryPath).replace(/\\/g, '/')

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

    // Sort: directories first, then by name
    fileItems.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
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
  if (EDITABLE_FOLDERS.length === 0) return false

  const normalizedPath = relativePath.replace(/\\/g, '/')
  return EDITABLE_FOLDERS.some((folder) => {
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
  return EDITABLE_FOLDERS
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
