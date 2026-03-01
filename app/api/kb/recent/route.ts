import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getKnowledgeBases, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'
import { validatePath, shouldExcludeFolder } from '@/lib/file-system'
import { config } from '@/lib/config'

const LIMIT = 10

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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const root = searchParams.get('root')

    if (!root) {
      return NextResponse.json({ results: [] })
    }

    const knowledgeBases = await getKnowledgeBases()
    const normalizedRoot = root.replace(/\\/g, '/')
    if (!getKnowledgeBaseRootForPath(normalizedRoot, knowledgeBases)) {
      return NextResponse.json({ error: 'Not within a knowledge base' }, { status: 400 })
    }

    const fullRoot = validatePath(root)
    const mediaDir = config.mediaDir

    const files: { path: string; mtime: number }[] = []
    await walkMarkdownFiles(fullRoot, mediaDir, files)

    const sorted = files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, LIMIT)
      .map(({ path: relPath, mtime }) => ({
        path: relPath,
        name: path.basename(relPath),
        modifiedAt: new Date(mtime).toISOString(),
      }))

    return NextResponse.json({ results: sorted })
  } catch (error) {
    console.error('KB recent error:', error)
    return NextResponse.json({ error: 'Failed to fetch recent files' }, { status: 500 })
  }
}
