import type { FastifyInstance } from 'fastify'
import {
  listDirectory,
  createDirectory,
  writeFile,
  writeBinaryFile,
  isPathEditable,
  fileExists,
  deleteDirectory,
  deleteFile,
  validatePath,
  renameFileOrDirectory,
  copyFileOrDirectory,
} from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { getSharesAsFileItems } from '@/lib/shares'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { getMediaType } from '@/lib/media-utils'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { config, getDataFilePath } from '@/lib/config'
import { promises as fs } from 'fs'
import path from 'path'

const STATS_FILE = getDataFilePath('stats.json')
const SETTINGS_FILE = getDataFilePath('settings.json')

async function getMostPlayedFiles(): Promise<FileItem[]> {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    const allStats = JSON.parse(data)
    const stats = allStats[config.mediaDir] || { views: {} }
    const views = stats.views || {}
    const sortedFiles = Object.entries(views)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 50)
    const results = await Promise.all(
      sortedFiles.map(async ([filePath, viewCount]): Promise<FileItem | null> => {
        try {
          const fullPath = path.join(config.mediaDir, filePath)
          const stat = await fs.stat(fullPath)
          if (stat.isDirectory()) return null
          const fileName = path.basename(filePath)
          const extension = path.extname(fileName).slice(1).toLowerCase()
          return {
            name: fileName,
            path: filePath,
            type: getMediaType(extension),
            size: stat.size,
            extension,
            isDirectory: false,
            viewCount: viewCount as number,
          }
        } catch {
          return null
        }
      }),
    )
    return results.filter((r): r is FileItem => r !== null)
  } catch {
    return []
  }
}

async function getFavoriteFiles(): Promise<FileItem[]> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    const allSettings = JSON.parse(data)
    const settings = allSettings[config.mediaDir] || { favorites: [] }
    const favorites = settings.favorites || []
    const results = await Promise.all(
      favorites.map(async (filePath: string): Promise<FileItem | null> => {
        try {
          const fullPath = path.join(config.mediaDir, filePath)
          const stat = await fs.stat(fullPath)
          const fileName = path.basename(filePath)
          const extension = path.extname(fileName).slice(1).toLowerCase()
          return {
            name: fileName,
            path: filePath,
            type: stat.isDirectory() ? MediaType.FOLDER : getMediaType(extension),
            size: stat.isDirectory() ? 0 : stat.size,
            extension,
            isDirectory: stat.isDirectory(),
          }
        } catch {
          return null
        }
      }),
    )
    return results.filter((r): r is FileItem => r !== null)
  } catch {
    return []
  }
}

function normalizeParent(dir: string): string {
  const p = dir.replace(/\\/g, '/')
  return p === '.' ? '' : p
}

export function registerFilesApiRoutes(app: FastifyInstance) {
  app.get('/api/files', async (request, reply) => {
    const { dir = '' } = request.query as { dir?: string }

    if (dir === VIRTUAL_FOLDERS.MOST_PLAYED) {
      const files = await getMostPlayedFiles()
      return reply.send({ files })
    }
    if (dir === VIRTUAL_FOLDERS.FAVORITES) {
      const files = await getFavoriteFiles()
      return reply.send({ files })
    }
    if (dir === VIRTUAL_FOLDERS.SHARES) {
      const files = await getSharesAsFileItems()
      return reply.send({ files })
    }

    const files = await listDirectory(dir)
    return reply.send({ files })
  })

  app.post('/api/files/create', async (request, reply) => {
    const body = request.body as {
      type: 'file' | 'folder'
      path: string
      content?: string
      base64Content?: string
    }

    if (!body.path) {
      return reply.code(400).send({ error: 'Path is required' })
    }

    const parentPath = normalizeParent(path.dirname(body.path))

    if (!isPathEditable(parentPath) && !isPathEditable(body.path)) {
      return reply.code(403).send({ error: 'Path is not in an editable folder' })
    }

    const exists = await fileExists(body.path)
    if (exists) {
      const itemType = body.type === 'folder' ? 'folder' : 'file'
      return reply.code(409).send({ error: `A ${itemType} with this name already exists` })
    }

    if (body.type === 'folder') {
      await createDirectory(body.path)
      broadcastFileChange(parentPath)
      return reply.send({ success: true, message: 'Folder created' })
    }

    if (body.content === undefined && body.base64Content === undefined) {
      return reply.code(400).send({ error: 'Content is required for files' })
    }

    if (body.base64Content) {
      await writeBinaryFile(body.path, body.base64Content)
    } else {
      await writeFile(body.path, body.content!)
    }
    broadcastFileChange(parentPath)
    return reply.send({ success: true, message: 'File saved' })
  })

  app.post('/api/files/edit', async (request, reply) => {
    const body = request.body as {
      path: string
      content?: string
      base64Content?: string
    }

    if (!body.path) {
      return reply.code(400).send({ error: 'Path is required' })
    }

    if (!isPathEditable(body.path)) {
      return reply.code(403).send({ error: 'Path is not in an editable folder' })
    }

    if (body.content === undefined && body.base64Content === undefined) {
      return reply.code(400).send({ error: 'Content is required' })
    }

    if (body.base64Content) {
      await writeBinaryFile(body.path, body.base64Content)
    } else {
      await writeFile(body.path, body.content!)
    }

    const parentDir = normalizeParent(path.dirname(body.path))
    broadcastFileChange(parentDir)
    return reply.send({ success: true, message: 'File saved' })
  })

  app.post('/api/files/delete', async (request, reply) => {
    const body = request.body as { path: string }

    if (!body.path) {
      return reply.code(400).send({ error: 'Path is required' })
    }

    const fullPath = validatePath(body.path)
    const stats = await fs.stat(fullPath)
    const parentDir = normalizeParent(path.dirname(body.path))

    if (stats.isDirectory()) {
      await deleteDirectory(body.path)
      broadcastFileChange(parentDir)
      return reply.send({ success: true, message: 'Folder deleted' })
    }

    await deleteFile(body.path)
    broadcastFileChange(parentDir)
    return reply.send({ success: true, message: 'File deleted' })
  })

  app.post('/api/files/rename', async (request, reply) => {
    const body = request.body as { oldPath: string; newPath: string }

    if (!body.oldPath || !body.newPath) {
      return reply.code(400).send({ error: 'Both oldPath and newPath are required' })
    }

    await renameFileOrDirectory(body.oldPath, body.newPath)
    const oldParent = normalizeParent(path.dirname(body.oldPath))
    const newParent = normalizeParent(path.dirname(body.newPath))
    broadcastFileChange(oldParent)
    if (newParent !== oldParent) {
      broadcastFileChange(newParent)
    }
    return reply.send({ success: true, message: 'Renamed successfully' })
  })

  app.post('/api/files/copy', async (request, reply) => {
    const body = request.body as { sourcePath: string; destinationDir: string }

    if (!body.sourcePath) {
      return reply.code(400).send({ error: 'sourcePath is required' })
    }

    await copyFileOrDirectory(body.sourcePath, body.destinationDir)
    const destParent = body.destinationDir.replace(/\\/g, '/')
    broadcastFileChange(destParent === '' ? '' : destParent)
    return reply.send({ success: true, message: 'Copied successfully' })
  })
}
