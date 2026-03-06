import type { FastifyInstance } from 'fastify'
import { promises as fs } from 'fs'
import path from 'path'
import { getKnowledgeBases, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'
import { validatePath, shouldExcludeFolder } from '@/lib/file-system'
import { config } from '@/lib/config'

const TEXT_EXTENSIONS = ['.md', '.txt']
const SNIPPET_MAX = 220
const RECENT_LIMIT = 10

async function walkTextFiles(dirPath: string, mediaDir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relPath = path.relative(mediaDir, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (shouldExcludeFolder(entry.name)) continue
      await walkTextFiles(fullPath, mediaDir, results)
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (TEXT_EXTENSIONS.includes(ext)) results.push(relPath)
    }
  }
}

async function walkMarkdownFiles(
  dirPath: string,
  mediaDir: string,
  results: { path: string; mtime: number }[],
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relPath = path.relative(mediaDir, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (shouldExcludeFolder(entry.name)) continue
      await walkMarkdownFiles(fullPath, mediaDir, results)
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (ext === '.md') {
        const stat = await fs.stat(fullPath)
        results.push({ path: relPath, mtime: stat.mtimeMs })
      }
    }
  }
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

export function registerKbApiRoutes(app: FastifyInstance) {
  app.get('/api/kb/search', async (request, reply) => {
    const { q = '', root = '' } = request.query as { q?: string; root?: string }

    if (!q.trim() || !root) {
      return reply.send({ results: [] })
    }

    const knowledgeBases = await getKnowledgeBases()
    if (!knowledgeBases.includes(root.replace(/\\/g, '/'))) {
      return reply.code(400).send({ error: 'Not a knowledge base' })
    }

    const fullRoot = validatePath(root)
    const mediaDir = config.mediaDir

    const textFiles: string[] = []
    await walkTextFiles(fullRoot, mediaDir, textFiles)

    const results: { path: string; name: string; snippet: string }[] = []
    const lowerQuery = q.trim().toLowerCase()

    for (const relPath of textFiles) {
      const fullPath = path.join(mediaDir, relPath)
      const content = await fs.readFile(fullPath, 'utf-8')
      if (!content.toLowerCase().includes(lowerQuery)) continue
      const snippet = extractSnippet(content, q.trim())
      results.push({
        path: relPath.replace(/\\/g, '/'),
        name: path.basename(relPath),
        snippet,
      })
    }

    return reply.send({ results })
  })

  app.get('/api/kb/recent', async (request, reply) => {
    const { root = '' } = request.query as { root?: string }

    if (!root) {
      return reply.send({ results: [] })
    }

    const knowledgeBases = await getKnowledgeBases()
    const normalizedRoot = root.replace(/\\/g, '/')
    if (!getKnowledgeBaseRootForPath(normalizedRoot, knowledgeBases)) {
      return reply.code(400).send({ error: 'Not within a knowledge base' })
    }

    const fullRoot = validatePath(root)
    const mediaDir = config.mediaDir

    const files: { path: string; mtime: number }[] = []
    await walkMarkdownFiles(fullRoot, mediaDir, files)

    const sorted = files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, RECENT_LIMIT)
      .map(({ path: relPath, mtime }) => ({
        path: relPath,
        name: path.basename(relPath),
        modifiedAt: new Date(mtime).toISOString(),
      }))

    return reply.send({ results: sorted })
  })
}
