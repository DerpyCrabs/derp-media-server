import type { FastifyInstance } from 'fastify'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import {
  getShare,
  getEffectiveRestrictions,
  checkUploadQuota,
  addShareUsedBytes,
  createShareSessionValue,
  isShareAccessAuthorized,
  updateShareWorkspaceTaskbarPins,
  updateShareWorkspaceLayoutPresets,
} from '@/lib/shares'
import {
  filterShareWorkspaceTaskbarPins,
  parseWorkspaceTaskbarPins,
} from '@/lib/workspace-taskbar-pins'
import {
  parseWorkspaceLayoutPresetsList,
  sanitizeShareWorkspaceLayoutPresets,
} from '@/lib/workspace-layout-presets-schema'
import {
  listDirectory,
  createDirectory,
  writeFile,
  writeBinaryFile,
  fileExists,
  deleteDirectory,
  deleteFile,
  validatePath,
  renameFileOrDirectory,
  shouldExcludeFolder,
} from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { getKnowledgeBases, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'
import { getMediaType } from '@/lib/media-utils'
import { config, getDataFilePath } from '@/lib/config'
import { Mutex } from '@/lib/mutex'
import { promises as fs } from 'fs'
import path from 'path'

const STATS_FILE = getDataFilePath('stats.json')
const statsMutex = new Mutex()

const verifyAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(token: string): boolean {
  const now = Date.now()
  const entry = verifyAttempts.get(token)
  if (!entry || now > entry.resetAt) {
    verifyAttempts.set(token, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

function normalizeParent(dir: string): string {
  const p = dir.replace(/\\/g, '/')
  return p === '.' ? '' : p
}

function estimateContentSize(content?: string, base64Content?: string): number {
  if (base64Content) return Math.ceil((base64Content.length * 3) / 4)
  if (content) return Buffer.byteLength(content, 'utf8')
  return 0
}

const TEXT_EXTENSIONS = ['.md', '.txt']
const SNIPPET_MAX = 220
const KB_RECENT_LIMIT = 10
const SEARCH_RESULT_LIMIT = 50

async function walkTextFiles(dirPath: string, mediaDir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      const relPath = path.relative(mediaDir, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (shouldExcludeFolder(entry.name)) return
        await walkTextFiles(fullPath, mediaDir, results)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (TEXT_EXTENSIONS.includes(ext)) results.push(relPath)
      }
    }),
  )
}

async function walkMarkdownFiles(
  dirPath: string,
  mediaDir: string,
  results: { path: string; mtime: number }[],
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      const relPath = path.relative(mediaDir, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (shouldExcludeFolder(entry.name)) return
        await walkMarkdownFiles(fullPath, mediaDir, results)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (ext === '.md') {
          const stat = await fs.stat(fullPath)
          results.push({ path: relPath, mtime: stat.mtimeMs })
        }
      }
    }),
  )
}

function extractSnippet(content: string, query: string): string {
  const lowerQuery = query.toLowerCase().trim()
  if (!lowerQuery) return ''
  const lines = content.split(/\r?\n/)
  const matchLineIdx = lines.findIndex((line) => line.toLowerCase().includes(lowerQuery))
  if (matchLineIdx < 0) return ''
  const matchLine = lines[matchLineIdx]
  const start = Math.max(0, matchLineIdx - 1)
  const end = Math.min(lines.length, matchLineIdx + 2)
  const snippet = lines.slice(start, end).join('\n').trim()
  if (snippet.length <= SNIPPET_MAX) return snippet
  const matchPos = matchLine.toLowerCase().indexOf(lowerQuery)
  if (matchLine.length <= SNIPPET_MAX) return matchLine
  const half = Math.floor(SNIPPET_MAX / 2)
  const from = Math.max(0, Math.min(matchPos - half, matchLine.length - SNIPPET_MAX))
  const slice = matchLine.slice(from, from + SNIPPET_MAX)
  return (from > 0 ? '...' : '') + slice + (from + SNIPPET_MAX < matchLine.length ? '...' : '')
}

export function registerShareAccessApiRoutes(app: FastifyInstance) {
  app.get('/api/share/:token/info', async (request, reply) => {
    const { token } = request.params as { token: string }

    const share = await getShare(token)
    if (!share) {
      return reply.code(404).send({ error: 'Share not found' })
    }

    const cookies = request.cookies as Record<string, string | undefined>
    const needsPasscode = Boolean(share.passcode)
    const authorized = isShareAccessAuthorized(share, {
      get: (name: string) => (cookies[name] ? { value: cookies[name]! } : undefined),
    })

    const name = path.basename(share.path) || share.path
    const extension = share.isDirectory ? '' : path.extname(share.path).slice(1).toLowerCase()
    const mediaType = share.isDirectory ? 'folder' : getMediaType(extension)

    const restrictions = share.editable ? getEffectiveRestrictions(share) : undefined
    const usedBytes = share.editable ? share.usedBytes || 0 : undefined

    const knowledgeBases = share.isDirectory ? await getKnowledgeBases() : []
    const isKnowledgeBase =
      share.isDirectory && getKnowledgeBaseRootForPath(share.path, knowledgeBases) !== null

    let adminViewMode: 'list' | 'grid' = 'list'
    if (share.isDirectory) {
      try {
        const settingsData = await fs.readFile(getDataFilePath('settings.json'), 'utf-8')
        const allSettings = JSON.parse(settingsData)
        const settings = allSettings[config.mediaDir]
        adminViewMode = settings?.viewModes?.[share.path] || 'list'
      } catch {}
    }

    const workspaceTaskbarPins =
      authorized && share.isDirectory
        ? filterShareWorkspaceTaskbarPins(
            share.path,
            token,
            parseWorkspaceTaskbarPins(share.workspaceTaskbarPins),
          )
        : undefined

    const workspaceLayoutPresets =
      authorized && share.isDirectory
        ? sanitizeShareWorkspaceLayoutPresets(
            share.path,
            token,
            parseWorkspaceLayoutPresetsList(share.workspaceLayoutPresets),
          )
        : undefined

    return reply.send({
      name,
      ...(authorized && { path: share.path }),
      isDirectory: share.isDirectory,
      editable: share.editable,
      mediaType,
      extension,
      needsPasscode,
      authorized,
      ...(restrictions && { restrictions }),
      ...(usedBytes !== undefined && { usedBytes }),
      isKnowledgeBase,
      adminViewMode,
      ...(workspaceTaskbarPins !== undefined && { workspaceTaskbarPins }),
      ...(workspaceLayoutPresets !== undefined && { workspaceLayoutPresets }),
    })
  })

  app.post('/api/share/:token/verify', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as { passcode?: string }

    const share = await getShare(token)
    if (!share) {
      return reply.code(404).send({ error: 'Share not found' })
    }

    if (!share.passcode) {
      return reply.send({ success: true })
    }

    if (!checkRateLimit(token)) {
      return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' })
    }

    if ((body.passcode || '') !== share.passcode) {
      return reply.code(401).send({ error: 'Invalid passcode' })
    }

    verifyAttempts.delete(token)

    const session = createShareSessionValue(share.token)
    reply.setCookie(session.name, session.value, {
      ...session.options,
      sameSite: session.options.sameSite as 'lax',
    })
    return reply.send({ success: true })
  })

  app.post('/api/share/:token/workspaceTaskbarPins', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as { items?: unknown }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.isDirectory) {
      return reply.code(400).send({ error: 'Share is not a directory' })
    }

    const parsed = filterShareWorkspaceTaskbarPins(
      share.path,
      token,
      parseWorkspaceTaskbarPins(body.items),
    )
    await updateShareWorkspaceTaskbarPins(token, parsed)
    return reply.send({ success: true, workspaceTaskbarPins: parsed })
  })

  app.post('/api/share/:token/workspaceLayoutPresets', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as { presets?: unknown }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.isDirectory) {
      return reply.code(400).send({ error: 'Share is not a directory' })
    }

    const parsed = sanitizeShareWorkspaceLayoutPresets(
      share.path,
      token,
      parseWorkspaceLayoutPresetsList(body.presets),
    )
    await updateShareWorkspaceLayoutPresets(token, parsed)
    return reply.send({ success: true, workspaceLayoutPresets: parsed })
  })

  app.get('/api/share/:token/files', async (request, reply) => {
    const { token } = request.params as { token: string }
    const { dir = '' } = request.query as { dir?: string }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.isDirectory) {
      return reply.code(400).send({ error: 'Share is not a directory' })
    }

    const resolved = resolveSharePath(share, dir)
    const allFiles = await listDirectory(resolved)
    const files = allFiles.filter((f) => !f.isVirtual)
    return reply.send({ files })
  })

  app.post('/api/share/:token/view', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as { filePath?: string }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    let resolvedPath: string
    if (share.isDirectory && body.filePath) {
      resolvedPath = resolveSharePath(share, body.filePath)
    } else {
      resolvedPath = share.path
    }

    const release = await statsMutex.acquire()
    try {
      let allStats: Record<
        string,
        { views: Record<string, number>; shareViews: Record<string, number> }
      > = {}
      try {
        const data = await fs.readFile(STATS_FILE, 'utf-8')
        allStats = JSON.parse(data)
      } catch {}

      const mediaDir = config.mediaDir
      if (!allStats[mediaDir]) {
        allStats[mediaDir] = { views: {}, shareViews: {} }
      }
      if (!allStats[mediaDir].shareViews) {
        allStats[mediaDir].shareViews = {}
      }

      allStats[mediaDir].shareViews[resolvedPath] =
        (allStats[mediaDir].shareViews[resolvedPath] || 0) + 1
      await fs.writeFile(STATS_FILE, JSON.stringify(allStats, null, 2), 'utf-8')
    } finally {
      release()
    }

    return reply.send({ success: true })
  })

  app.post('/api/share/:token/create', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as {
      type: 'file' | 'folder'
      path: string
      content?: string
      base64Content?: string
    }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.editable) {
      return reply.code(403).send({ error: 'Share is not editable' })
    }

    const restrictions = getEffectiveRestrictions(share)
    if (!restrictions.allowUpload) {
      return reply.code(403).send({ error: 'Creating files/folders is not allowed for this share' })
    }

    const resolved = resolveSharePath(share, body.path)

    const exists = await fileExists(resolved)
    if (exists) {
      const itemType = body.type === 'folder' ? 'folder' : 'file'
      return reply.code(409).send({ error: `A ${itemType} with this name already exists` })
    }

    const parentDir = normalizeParent(path.dirname(resolved))

    if (body.type === 'folder') {
      await createDirectory(resolved)
      broadcastFileChange(parentDir, resolved)
      return reply.send({ success: true, message: 'Folder created' })
    }

    if (body.content === undefined && body.base64Content === undefined) {
      return reply.code(400).send({ error: 'Content is required for files' })
    }

    const contentSize = estimateContentSize(body.content, body.base64Content)
    const quota = checkUploadQuota(share, contentSize)
    if (!quota.allowed) {
      return reply.code(413).send({ error: 'Upload quota exceeded for this share' })
    }

    if (body.base64Content) {
      await writeBinaryFile(resolved, body.base64Content)
    } else {
      await writeFile(resolved, body.content!)
    }

    if (contentSize > 0) await addShareUsedBytes(token, contentSize)
    broadcastFileChange(parentDir, resolved)
    return reply.send({ success: true, message: 'File saved' })
  })

  app.post('/api/share/:token/edit', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as {
      path: string
      content?: string
      base64Content?: string
    }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.editable) {
      return reply.code(403).send({ error: 'Share is not editable' })
    }

    const restrictions = getEffectiveRestrictions(share)
    if (!restrictions.allowEdit) {
      return reply.code(403).send({ error: 'Editing files is not allowed for this share' })
    }

    const resolved = resolveSharePath(share, body.path)

    if (body.content === undefined && body.base64Content === undefined) {
      return reply.code(400).send({ error: 'Content is required' })
    }

    const contentSize = body.base64Content
      ? Math.ceil((body.base64Content.length * 3) / 4)
      : Buffer.byteLength(body.content || '', 'utf8')

    const quota = checkUploadQuota(share, contentSize)
    if (!quota.allowed) {
      return reply.code(413).send({ error: 'Upload quota exceeded for this share' })
    }

    if (body.base64Content) {
      await writeBinaryFile(resolved, body.base64Content)
    } else {
      await writeFile(resolved, body.content!)
    }

    if (contentSize > 0) await addShareUsedBytes(token, contentSize)
    const parentDir = normalizeParent(path.dirname(resolved))
    broadcastFileChange(parentDir, resolved)
    return reply.send({ success: true, message: 'File saved' })
  })

  app.post('/api/share/:token/delete', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as { path: string }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.editable) {
      return reply.code(403).send({ error: 'Share is not editable' })
    }

    if (!getEffectiveRestrictions(share).allowDelete) {
      return reply.code(403).send({ error: 'Deletion is not allowed for this share' })
    }

    const resolved = resolveSharePath(share, body.path)

    if (resolved === share.path) {
      return reply.code(403).send({ error: 'Cannot delete share root' })
    }

    const fullPath = validatePath(resolved)
    const stats = await fs.stat(fullPath)
    const parentDir = normalizeParent(path.dirname(resolved))

    if (stats.isDirectory()) {
      await deleteDirectory(resolved)
      broadcastFileChange(parentDir, resolved)
      return reply.send({ success: true, message: 'Folder deleted' })
    }

    await deleteFile(resolved)
    broadcastFileChange(parentDir, resolved)
    return reply.send({ success: true, message: 'File deleted' })
  })

  app.post('/api/share/:token/rename', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body as { oldPath: string; newPath: string }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.editable) {
      return reply.code(403).send({ error: 'Share is not editable' })
    }

    if (!getEffectiveRestrictions(share).allowEdit) {
      return reply.code(403).send({ error: 'Editing is not allowed for this share' })
    }

    const resolvedOld = resolveSharePath(share, body.oldPath)
    const resolvedNew = resolveSharePath(share, body.newPath)

    await renameFileOrDirectory(resolvedOld, resolvedNew)
    const oldParent = normalizeParent(path.dirname(resolvedOld))
    const newParent = normalizeParent(path.dirname(resolvedNew))
    broadcastFileChange(oldParent, resolvedOld)
    if (newParent !== oldParent) {
      broadcastFileChange(newParent, resolvedNew)
    }
    return reply.send({ success: true, message: 'Renamed successfully' })
  })

  app.get('/api/share/:token/kb/search', async (request, reply) => {
    const { token } = request.params as { token: string }
    const { q = '', dir = '' } = request.query as { q?: string; dir?: string }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.isDirectory) {
      return reply.code(400).send({ error: 'Share is not a directory' })
    }

    const knowledgeBases = await getKnowledgeBases()
    if (!getKnowledgeBaseRootForPath(share.path, knowledgeBases)) {
      return reply.code(400).send({ error: 'Share is not a knowledge base' })
    }

    const trimmedQ = q.trim()
    if (!trimmedQ) return reply.send({ results: [] })

    const searchRoot = resolveSharePath(share, dir)
    const fullRoot = validatePath(searchRoot)
    const mediaDir = config.mediaDir

    const textFiles: string[] = []
    await walkTextFiles(fullRoot, mediaDir, textFiles)

    const results: { path: string; name: string; snippet: string }[] = []
    const lowerQuery = trimmedQ.toLowerCase()

    /* eslint-disable no-await-in-loop -- stop after SEARCH_RESULT_LIMIT; sequential reads */
    for (const relPath of textFiles) {
      if (results.length >= SEARCH_RESULT_LIMIT) break
      const fullPath = path.join(mediaDir, relPath)
      const content = await fs.readFile(fullPath, 'utf-8')
      if (!content.toLowerCase().includes(lowerQuery)) continue
      const snippet = extractSnippet(content, trimmedQ)
      results.push({
        path: relPath.replace(/\\/g, '/'),
        name: path.basename(relPath),
        snippet,
      })
    }
    /* eslint-enable no-await-in-loop */

    return reply.send({ results })
  })

  app.get('/api/share/:token/kb/recent', async (request, reply) => {
    const { token } = request.params as { token: string }
    const { dir = '' } = request.query as { dir?: string }

    const cookies = request.cookies as Record<string, string | undefined>
    const { share } = await validateShareAccess(cookies, token)

    if (!share.isDirectory) {
      return reply.code(400).send({ error: 'Share is not a directory' })
    }

    const knowledgeBases = await getKnowledgeBases()
    if (!getKnowledgeBaseRootForPath(share.path, knowledgeBases)) {
      return reply.code(400).send({ error: 'Share is not a knowledge base' })
    }

    const scopePath = resolveSharePath(share, dir)
    const fullRoot = validatePath(scopePath)
    const mediaDir = config.mediaDir

    const files: { path: string; mtime: number }[] = []
    await walkMarkdownFiles(fullRoot, mediaDir, files)

    const sorted = files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, KB_RECENT_LIMIT)
      .map(({ path: relPath, mtime }) => ({
        path: relPath,
        name: path.basename(relPath),
        modifiedAt: new Date(mtime).toISOString(),
      }))

    return reply.send({ results: sorted })
  })
}
