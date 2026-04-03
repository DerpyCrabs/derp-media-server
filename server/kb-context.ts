import { promises as fs } from 'fs'
import path from 'path'
import { config } from '@/lib/config'
import { shouldExcludeFolder } from '@/lib/file-system'

const TEXT_EXTENSIONS = new Set(['.md', '.txt'])
const DEFAULT_CHAR_BUDGET = 32_000

interface KbFile {
  relPath: string
  content: string
  mtime: number
}

async function walkKbFiles(dirPath: string, mediaDir: string, results: KbFile[]): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (shouldExcludeFolder(entry.name)) return
        await walkKbFiles(fullPath, mediaDir, results)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (!TEXT_EXTENSIONS.has(ext)) return
        try {
          const [content, stat] = await Promise.all([
            fs.readFile(fullPath, 'utf-8'),
            fs.stat(fullPath),
          ])
          const relPath = path.relative(mediaDir, fullPath).replace(/\\/g, '/')
          results.push({ relPath, content, mtime: stat.mtimeMs })
        } catch {
          // skip unreadable files
        }
      }
    }),
  )
}

export async function gatherKbContext(
  kbRoot: string,
  userQuery: string,
  charBudget: number = DEFAULT_CHAR_BUDGET,
): Promise<string> {
  const fullRoot = path.join(config.mediaDir, kbRoot)
  const files: KbFile[] = []
  await walkKbFiles(fullRoot, config.mediaDir, files)

  if (files.length === 0) return ''

  const lowerQuery = userQuery.toLowerCase().trim()
  const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 2)

  const scored = files.map((f) => {
    let score = 0
    const lowerContent = f.content.toLowerCase()
    const lowerPath = f.relPath.toLowerCase()
    for (const term of queryTerms) {
      if (lowerContent.includes(term)) score += 10
      if (lowerPath.includes(term)) score += 5
    }
    if (score === 0) score = -1
    return { ...f, score }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.mtime - a.mtime
  })

  let used = 0
  const parts: string[] = []
  for (const f of scored) {
    const block = `## ${f.relPath}\n\n${f.content}\n`
    if (used + block.length > charBudget && parts.length > 0) break
    parts.push(block)
    used += block.length
  }

  return parts.join('\n---\n\n')
}
