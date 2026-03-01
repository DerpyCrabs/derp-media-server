import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { validateShareAccess } from '@/lib/share-access'
import { getKnowledgeBases, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'
import { validatePath, shouldExcludeFolder } from '@/lib/file-system'
import { config } from '@/lib/config'

const TEXT_EXTENSIONS = ['.md', '.txt']

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
      if (TEXT_EXTENSIONS.includes(ext)) {
        results.push(relPath)
      }
    }
  }
}

const SNIPPET_MAX = 220

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof NextResponse) return result
    const { share } = result

    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Share is not a directory' }, { status: 400 })
    }

    const knowledgeBases = await getKnowledgeBases()
    if (!getKnowledgeBaseRootForPath(share.path, knowledgeBases)) {
      return NextResponse.json({ error: 'Share is not a knowledge base' }, { status: 400 })
    }

    const q = request.nextUrl.searchParams.get('q')?.trim()
    if (!q) {
      return NextResponse.json({ results: [] })
    }

    const subDir = request.nextUrl.searchParams.get('dir') || ''
    const searchRoot = subDir
      ? `${share.path.replace(/\\/g, '/')}/${subDir.replace(/\\/g, '/')}`
      : share.path.replace(/\\/g, '/')

    const fullRoot = validatePath(searchRoot)
    const mediaDir = config.mediaDir

    const textFiles: string[] = []
    await walkTextFiles(fullRoot, mediaDir, textFiles)

    const results: { path: string; name: string; snippet: string }[] = []
    const lowerQuery = q.toLowerCase()

    for (const relPath of textFiles) {
      const fullPath = path.join(mediaDir, relPath)
      const content = await fs.readFile(fullPath, 'utf-8')
      if (!content.toLowerCase().includes(lowerQuery)) continue
      const snippet = extractSnippet(content, q)
      results.push({
        path: relPath.replace(/\\/g, '/'),
        name: path.basename(relPath),
        snippet,
      })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Share KB search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
