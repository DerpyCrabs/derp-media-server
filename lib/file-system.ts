import { promises as fs } from 'fs'
import path from 'path'
import { FileItem, MediaType } from './types'
import { getMediaType } from './media-utils'
import { VIRTUAL_FOLDERS } from './constants'
import { hasCachedThumbnail } from '@/server/lib/thumbnails'
import {
  config,
  getMediaRootByName,
  getMediaRoots,
  hasMultipleMediaRoots,
  type MediaRoot,
} from './config'

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

const EXCLUDED_FILES = [
  'pagefile.sys',
  'swapfile.sys',
  'hiberfil.sys',
  'DumpStack.log',
  'DumpStack.log.tmp',
  'desktop.ini',
  'Thumbs.db',
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
 * Validates and resolves a path to ensure it's within a configured media root
 * Prevents path traversal attacks
 */
export interface ResolvedMediaPath {
  root: MediaRoot
  relativePath: string
  logicalPath: string
  fullPath: string
}

function normalizeLogicalPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const clean = path.posix.normalize(normalized)
  return clean === '.' ? '' : clean.replace(/^\/+/, '')
}

function isInsideRoot(resolvedPath: string, resolvedRoot: string): boolean {
  const rel = path.relative(resolvedRoot, resolvedPath)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function toLogicalMediaPath(root: MediaRoot, rootRelativePath: string): string {
  const normalized = rootRelativePath.replace(/\\/g, '/')
  if (!hasMultipleMediaRoots()) return normalized
  return normalized ? `${root.name}/${normalized}` : root.name
}

export function resolveMediaPath(relativePath: string): ResolvedMediaPath {
  const logicalPath = normalizeLogicalPath(relativePath)
  let root: MediaRoot
  let rootRelativePath: string

  if (hasMultipleMediaRoots()) {
    const [rootName = '', ...rest] = logicalPath.split('/').filter(Boolean)
    if (!rootName) throw new Error('Invalid path: Media root is required')
    const found = getMediaRootByName(rootName)
    if (!found) throw new Error('Invalid path: Unknown media root')
    root = found
    rootRelativePath = rest.join('/')
  } else {
    root = getMediaRoots()[0]
    rootRelativePath = logicalPath
  }

  const platformPath = rootRelativePath.replace(/\//g, path.sep)
  const normalizedPath = path.normalize(platformPath).replace(/^(\.\.(\/|\\|$))+/, '')
  const fullPath = path.join(root.path, normalizedPath)
  const resolvedPath = path.resolve(fullPath)
  const resolvedRoot = path.resolve(root.path)

  if (!isInsideRoot(resolvedPath, resolvedRoot)) {
    throw new Error('Invalid path: Path traversal detected')
  }

  return {
    root,
    relativePath: rootRelativePath,
    logicalPath: toLogicalMediaPath(root, rootRelativePath),
    fullPath: resolvedPath,
  }
}

export function validatePath(relativePath: string): string {
  return resolveMediaPath(relativePath).fullPath
}

export function getLibraryKey(): string {
  return config.libraryKey
}

function createVirtualFolderItems(): FileItem[] {
  return [
    {
      name: 'Favorites',
      path: VIRTUAL_FOLDERS.FAVORITES,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      isVirtual: true,
    },
    {
      name: 'Most Played',
      path: VIRTUAL_FOLDERS.MOST_PLAYED,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      isVirtual: true,
    },
    {
      name: 'Shares',
      path: VIRTUAL_FOLDERS.SHARES,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      isVirtual: true,
    },
  ]
}

function createRootFolderItems(): FileItem[] {
  if (!hasMultipleMediaRoots()) return []
  return getMediaRoots().map((root) => ({
    name: root.name,
    path: root.name,
    type: MediaType.FOLDER,
    size: 0,
    extension: '',
    isDirectory: true,
  }))
}

/**
 * Lists files and folders in a directory
 * @param relativePath Path relative to media directory (empty string for root)
 * @returns Array of FileItem objects
 */
export async function listDirectory(relativePath: string = ''): Promise<FileItem[]> {
  try {
    const normalizedRelativePath = normalizeLogicalPath(relativePath)
    const fileItems: FileItem[] =
      normalizedRelativePath === ''
        ? [...createVirtualFolderItems(), ...createRootFolderItems()]
        : []

    if (hasMultipleMediaRoots() && normalizedRelativePath === '') {
      fileItems.sort((a, b) => {
        if (a.isVirtual && !b.isVirtual) return -1
        if (!a.isVirtual && b.isVirtual) return 1
        return a.name.localeCompare(b.name, undefined, { numeric: true })
      })
      return fileItems
    }

    const resolved = resolveMediaPath(relativePath)
    const mediaDir = resolved.root.path
    const fullPath = resolved.fullPath

    // Check if path exists and is a directory
    const stats = await fs.stat(fullPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true })

    const filteredEntries = entries.filter((entry) => {
      if (entry.isDirectory() && shouldExcludeFolder(entry.name)) return false
      if (!entry.isDirectory() && EXCLUDED_FILES.includes(entry.name)) return false
      return true
    })

    const results = await Promise.all(
      filteredEntries.map(async (entry): Promise<FileItem | null> => {
        try {
          const entryPath = path.join(fullPath, entry.name)
          const relPath = path.relative(mediaDir, entryPath).replace(/\\/g, '/')
          const logicalPath = toLogicalMediaPath(resolved.root, relPath)

          if (entry.isDirectory()) {
            return {
              name: entry.name,
              path: logicalPath,
              type: MediaType.FOLDER,
              size: 0,
              extension: '',
              isDirectory: true,
            }
          }

          const stats = await fs.stat(entryPath)
          const extension = path.extname(entry.name).slice(1).toLowerCase()
          const type = getMediaType(extension)
          return {
            name: entry.name,
            path: logicalPath,
            type,
            size: stats.size,
            extension,
            isDirectory: false,
            thumbnailGenerated:
              type === MediaType.IMAGE || type === MediaType.VIDEO
                ? hasCachedThumbnail(entryPath, stats.mtime)
                : undefined,
          }
        } catch {
          return null
        }
      }),
    )

    fileItems.push(...results.filter((r): r is FileItem => r !== null))

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
  let resolved: ResolvedMediaPath
  try {
    resolved = resolveMediaPath(relativePath)
  } catch {
    return false
  }

  const editableFolders = resolved.root.editableFolders
  if (editableFolders.length === 0) return false

  const normalizedPath = resolved.relativePath.replace(/\\/g, '/')
  return editableFolders.some((folder) => {
    const normalizedFolder = folder.replace(/\\/g, '/')
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + '/')
  })
}

/**
 * Gets the list of editable folders
 */
export function getEditableFolders(): string[] {
  if (!hasMultipleMediaRoots()) return config.mediaRoots[0]?.editableFolders ?? []
  return config.mediaRoots.flatMap((root) =>
    root.editableFolders.map((folder) => `${root.name}/${folder.replace(/\\/g, '/')}`),
  )
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
 * Deletes a directory and all its contents recursively
 */
export async function deleteDirectory(relativePath: string): Promise<void> {
  const fullPath = validatePath(relativePath)

  if (!isPathEditable(relativePath)) {
    throw new Error('Cannot delete directory: Path is not in an editable folder')
  }

  const stats = await fs.stat(fullPath)
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  await fs.rm(fullPath, { recursive: true })
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

/**
 * Copies a file or directory to a destination folder
 * Source can be anywhere in mediaDir (readable). Destination must be in an editable folder.
 */
export async function copyFileOrDirectory(
  sourceRelativePath: string,
  destinationDir: string,
): Promise<void> {
  const sourceFullPath = validatePath(sourceRelativePath)
  const destDirPath = destinationDir.replace(/\\/g, '/')
  const fileName = sourceRelativePath.split(/[/\\]/).pop()
  if (!fileName) throw new Error('Invalid source path')
  const destRelativePath = destDirPath ? `${destDirPath}/${fileName}` : fileName
  const destFullPath = validatePath(destRelativePath)

  // Destination must be in an editable folder
  if (!isPathEditable(destRelativePath)) {
    throw new Error('Cannot copy: Destination is not in an editable folder')
  }

  const sourceStats = await fs.stat(sourceFullPath)
  if (!sourceStats.isDirectory() && !sourceStats.isFile()) {
    throw new Error('Source is not a file or directory')
  }

  const destExists = await fileExists(destRelativePath)
  if (destExists) {
    throw new Error('Destination file or directory already exists')
  }

  await fs.cp(sourceFullPath, destFullPath, { recursive: true })
}
