import path from 'path'
import { promises as fs } from 'fs'
import { config } from '@/lib/config'

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

export async function getKnowledgeBases(): Promise<string[]> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(data)
    const settings = parsed[config.mediaDir] || {}
    return settings.knowledgeBases || []
  } catch {
    return []
  }
}

export function getKnowledgeBaseRootForPath(
  filePath: string,
  knowledgeBases: string[],
): string | null {
  if (knowledgeBases.length === 0) return null
  const normalized = filePath.replace(/\\/g, '/')
  for (const kb of knowledgeBases) {
    const normalizedKb = kb.replace(/\\/g, '/')
    if (normalized === normalizedKb || normalized.startsWith(normalizedKb + '/')) {
      return normalizedKb
    }
  }
  return null
}

export function isKnowledgeBaseImagePath(
  requestedPath: string,
  sharePath: string,
  knowledgeBases: string[],
): boolean {
  const normalized = requestedPath.replace(/\\/g, '/')
  const kbRoot = getKnowledgeBaseRootForPath(sharePath, knowledgeBases)
  if (!kbRoot) return false
  const imagesDir = `${kbRoot.replace(/\\/g, '/')}/images/`
  if (!normalized.startsWith(imagesDir)) return false
  const relativeToImages = normalized.slice(imagesDir.length)
  return !relativeToImages.includes('/') && !relativeToImages.includes('\\')
}
