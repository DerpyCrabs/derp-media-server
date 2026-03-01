import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { validateShareAccess } from '@/lib/share-access'
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

    const subDir = request.nextUrl.searchParams.get('dir') || ''
    const scopePath = subDir
      ? `${share.path.replace(/\\/g, '/')}/${subDir.replace(/\\/g, '/')}`
      : share.path.replace(/\\/g, '/')

    const fullRoot = validatePath(scopePath)
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
    console.error('Share KB recent error:', error)
    return NextResponse.json({ error: 'Failed to fetch recent files' }, { status: 500 })
  }
}
