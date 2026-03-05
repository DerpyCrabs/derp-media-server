import { QueryClient, dehydrate } from '@tanstack/react-query'
import { listDirectory, getEditableFolders } from '@/lib/file-system'
import { config } from '@/lib/config'
import { promises as fs } from 'fs'
import path from 'path'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { getMediaType } from '@/lib/media-utils'
import { FileItem, MediaType } from '@/lib/types'
import {
  getShare,
  isShareAccessAuthorized,
  getEffectiveRestrictions,
  getSharesAsFileItems,
} from '@/lib/shares'
import { getKnowledgeBases, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')
const STATS_FILE = path.join(process.cwd(), 'stats.json')

async function readSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    const allSettings = JSON.parse(data)
    return (
      allSettings[config.mediaDir] || {
        viewModes: {},
        favorites: [],
        knowledgeBases: [],
        customIcons: {},
        autoSave: {},
      }
    )
  } catch {
    return { viewModes: {}, favorites: [], knowledgeBases: [], customIcons: {}, autoSave: {} }
  }
}

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

async function fetchFiles(dir: string): Promise<FileItem[]> {
  if (dir === VIRTUAL_FOLDERS.MOST_PLAYED) return getMostPlayedFiles()
  if (dir === VIRTUAL_FOLDERS.FAVORITES) return getFavoriteFiles()
  if (dir === VIRTUAL_FOLDERS.SHARES) return getSharesAsFileItems()
  return listDirectory(dir)
}

export async function dehydrateForRoute(
  urlPath: string,
  searchParams: URLSearchParams,
  cookies: Record<string, string>,
): Promise<string> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 1000 * 60 * 5 } },
  })

  try {
    if (urlPath === '/' || urlPath === '') {
      const dir = searchParams.get('dir') || ''
      const isVirtualFolder = (Object.values(VIRTUAL_FOLDERS) as string[]).includes(dir)

      const prefetchPromises: Promise<void>[] = []

      if (!isVirtualFolder) {
        prefetchPromises.push(
          queryClient.prefetchQuery({
            queryKey: ['files', dir],
            queryFn: async () => {
              const files = await fetchFiles(dir)
              return { files }
            },
          }),
        )
      }

      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: ['settings'],
          queryFn: readSettings,
        }),
        queryClient.prefetchQuery({
          queryKey: ['auth-config'],
          queryFn: () => ({
            enabled: config.auth?.enabled ?? false,
            shareLinkDomain: config.shareLinkDomain ?? undefined,
            editableFolders: getEditableFolders(),
          }),
        }),
      )

      await Promise.all(prefetchPromises)
    } else {
      const shareMatch = urlPath.match(/^\/share\/([^/]+)/)
      if (shareMatch) {
        const token = shareMatch[1]
        const share = await getShare(token)
        if (share) {
          const name = path.basename(share.path) || share.path
          const extension = share.isDirectory ? '' : path.extname(share.path).slice(1).toLowerCase()
          const mediaType = share.isDirectory ? 'folder' : getMediaType(extension)
          const needsPasscode = Boolean(share.passcode)

          const cookieAdapter = {
            get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined),
          }
          const authorized = isShareAccessAuthorized(share, cookieAdapter)
          const restrictions = share.editable ? getEffectiveRestrictions(share) : undefined
          const knowledgeBases = share.isDirectory ? await getKnowledgeBases() : []
          const isKnowledgeBase =
            share.isDirectory && getKnowledgeBaseRootForPath(share.path, knowledgeBases) !== null

          let adminViewMode: 'list' | 'grid' = 'list'
          if (share.isDirectory) {
            try {
              const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
              const allSettings = JSON.parse(data)
              const settings = allSettings[config.mediaDir]
              adminViewMode = settings?.viewModes?.[share.path] || 'list'
            } catch {}
          }

          await queryClient.prefetchQuery({
            queryKey: ['share-info', token],
            queryFn: () => ({
              name,
              ...(authorized && { path: share.path }),
              isDirectory: share.isDirectory,
              editable: share.editable,
              mediaType,
              extension,
              needsPasscode,
              authorized,
              ...(restrictions && { restrictions }),
              isKnowledgeBase,
              adminViewMode,
            }),
          })
        }
      }
    }
  } catch (err) {
    console.error('Error during dehydration prefetch:', err)
  }

  const dehydratedState = dehydrate(queryClient)
  queryClient.clear()
  return JSON.stringify(dehydratedState)
}
