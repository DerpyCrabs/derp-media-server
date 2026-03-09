import { QueryClient, dehydrate } from '@tanstack/react-query'
import {
  listDirectory,
  getEditableFolders,
  validatePath,
  shouldExcludeFolder,
} from '@/lib/file-system'
import { config, getDataFilePath } from '@/lib/config'
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
  getAllShares,
  resolveShareSubPath,
  type ShareLink,
} from '@/lib/shares'
import { getKnowledgeBases, getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'
import { extractAudioMetadata } from '@/server/lib/audio-helpers'
import { queryKeys } from '@/lib/query-keys'

const SETTINGS_FILE = getDataFilePath('settings.json')
const STATS_FILE = getDataFilePath('stats.json')
const KB_RECENT_LIMIT = 10

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

async function readStats() {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    const allStats = JSON.parse(data)
    const stats = allStats[config.mediaDir] || { views: {}, shareViews: {} }
    return {
      views: stats.views || {},
      shareViews: stats.shareViews || {},
    }
  } catch {
    return { views: {}, shareViews: {} }
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
    } else if (path.extname(entry.name).toLowerCase() === '.md') {
      const stat = await fs.stat(fullPath)
      results.push({ path: relPath, mtime: stat.mtimeMs })
    }
  }
}

async function getKnowledgeBaseRecentFiles(root: string) {
  const fullRoot = validatePath(root)
  const files: { path: string; mtime: number }[] = []
  await walkMarkdownFiles(fullRoot, config.mediaDir, files)

  return {
    results: files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, KB_RECENT_LIMIT)
      .map(({ path: relPath, mtime }) => ({
        path: relPath,
        name: path.basename(relPath),
        modifiedAt: new Date(mtime).toISOString(),
      })),
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function getParentDirectory(filePath: string): string {
  const normalized = normalizePath(filePath)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

async function getTextFileContent(filePath: string): Promise<string> {
  return fs.readFile(validatePath(filePath), 'utf-8')
}

async function getAudioFileMetadata(filePath: string) {
  return extractAudioMetadata(validatePath(filePath))
}

async function getSharedFiles(dir: string) {
  const allFiles = await listDirectory(dir)
  return { files: allFiles.filter((file) => !file.isVirtual) }
}

function resolveShareFilePath(share: ShareLink, requestedPath: string): string | null {
  const normalizedSharePath = normalizePath(share.path)
  const normalizedRequestedPath = normalizePath(requestedPath)

  if (!share.isDirectory) {
    return normalizedRequestedPath === normalizedSharePath ? normalizedSharePath : null
  }

  if (
    normalizedRequestedPath === normalizedSharePath ||
    normalizedRequestedPath.startsWith(`${normalizedSharePath}/`)
  ) {
    return normalizedRequestedPath
  }

  const resolved = resolveShareSubPath(share, normalizedRequestedPath)
  return resolved ? normalizePath(resolved) : null
}

function getShareListingDir(share: ShareLink, dirParam: string | null, filePath: string): string {
  if (dirParam !== null) return normalizePath(dirParam)

  const resolvedPath = resolveShareFilePath(share, filePath)
  if (!resolvedPath) return ''

  const relativePath = resolvedPath.startsWith(`${normalizePath(share.path)}/`)
    ? resolvedPath.slice(normalizePath(share.path).length + 1)
    : ''

  return getParentDirectory(relativePath)
}

async function prefetchDirectViewerQueries(
  queryClient: QueryClient,
  dirParam: string | null,
  viewingPath: string | null,
  playingPath: string | null,
) {
  const prefetchPromises: Promise<void>[] = []

  if (viewingPath) {
    const viewingExtension = path.extname(viewingPath).slice(1).toLowerCase()
    const viewingType = getMediaType(viewingExtension)

    if (viewingType === MediaType.TEXT) {
      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.textContent(viewingPath),
          queryFn: () => getTextFileContent(viewingPath),
        }),
      )
    }

    const viewingDir = dirParam ?? getParentDirectory(viewingPath)
    if (viewingDir !== null && viewingType !== MediaType.TEXT && viewingType !== MediaType.PDF) {
      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.files(viewingDir),
          queryFn: async () => {
            const files = await fetchFiles(viewingDir)
            return { files }
          },
        }),
      )
    }
  }

  if (playingPath) {
    const playingExtension = path.extname(playingPath).slice(1).toLowerCase()
    const playingType = getMediaType(playingExtension)
    const playingDir = dirParam ?? getParentDirectory(playingPath)

    if (playingType === MediaType.AUDIO) {
      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.audioMetadata(playingPath),
          queryFn: () => getAudioFileMetadata(playingPath),
        }),
      )
    }

    if (
      playingDir !== null &&
      (playingType === MediaType.AUDIO || playingType === MediaType.VIDEO)
    ) {
      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.files(playingDir),
          queryFn: async () => {
            const files = await fetchFiles(playingDir)
            return { files }
          },
        }),
      )
    }
  }

  await Promise.all(prefetchPromises)
}

async function prefetchShareViewerQueries(
  queryClient: QueryClient,
  share: ShareLink,
  shareDirParam: string | null,
  viewingPath: string | null,
  playingPath: string | null,
) {
  const prefetchPromises: Promise<void>[] = []

  if (viewingPath) {
    const resolvedViewingPath = resolveShareFilePath(share, viewingPath)
    const viewingExtension = path.extname(viewingPath).slice(1).toLowerCase()
    const viewingType = getMediaType(viewingExtension)

    if (resolvedViewingPath && viewingType === MediaType.TEXT) {
      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.shareText(share.token, viewingPath),
          queryFn: () => getTextFileContent(resolvedViewingPath),
        }),
      )
    }

    if (share.isDirectory && viewingType !== MediaType.TEXT && viewingType !== MediaType.PDF) {
      const viewingDir = getShareListingDir(share, shareDirParam, viewingPath)
      const resolvedViewingDir = resolveShareSubPath(share, viewingDir)
      if (resolvedViewingDir) {
        prefetchPromises.push(
          queryClient.prefetchQuery({
            queryKey: queryKeys.shareFiles(share.token, viewingDir),
            queryFn: () => getSharedFiles(resolvedViewingDir),
          }),
        )
      }
    }
  }

  if (playingPath) {
    const resolvedPlayingPath = resolveShareFilePath(share, playingPath)
    const playingExtension = path.extname(playingPath).slice(1).toLowerCase()
    const playingType = getMediaType(playingExtension)

    if (resolvedPlayingPath && playingType === MediaType.AUDIO) {
      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.audioMetadata(playingPath),
          queryFn: () => getAudioFileMetadata(resolvedPlayingPath),
        }),
      )
    }

    if (share.isDirectory && (playingType === MediaType.AUDIO || playingType === MediaType.VIDEO)) {
      const playingDir = getShareListingDir(share, shareDirParam, playingPath)
      const resolvedPlayingDir = resolveShareSubPath(share, playingDir)
      if (resolvedPlayingDir) {
        prefetchPromises.push(
          queryClient.prefetchQuery({
            queryKey: queryKeys.shareFiles(share.token, playingDir),
            queryFn: () => getSharedFiles(resolvedPlayingDir),
          }),
        )
      }
    }
  }

  await Promise.all(prefetchPromises)
}

export async function dehydrateForRoute(
  urlPath: string,
  searchParams: URLSearchParams,
  cookies: Record<string, string>,
): Promise<string> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })

  try {
    if (urlPath === '/' || urlPath === '' || urlPath === '/workspace') {
      const dirParam = searchParams.get('dir')
      const dir = dirParam || ''
      const viewingPath = searchParams.get('viewing')
      const playingPath = searchParams.get('playing')
      const isVirtualFolder = (Object.values(VIRTUAL_FOLDERS) as string[]).includes(dir)
      const knowledgeBases = dir ? await getKnowledgeBases() : []
      const isKnowledgeBase =
        !!dir && getKnowledgeBaseRootForPath(dir.replace(/\\/g, '/'), knowledgeBases) !== null

      const prefetchPromises: Promise<void>[] = []

      if ((urlPath === '/' || urlPath === '') && !isVirtualFolder) {
        prefetchPromises.push(
          queryClient.prefetchQuery({
            queryKey: queryKeys.files(dir),
            queryFn: async () => {
              const files = await fetchFiles(dir)
              return { files }
            },
          }),
        )
      }

      prefetchPromises.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.settings(),
          queryFn: readSettings,
        }),
        queryClient.prefetchQuery({
          queryKey: queryKeys.shares(),
          queryFn: async () => ({ shares: await getAllShares() }),
        }),
        queryClient.prefetchQuery({
          queryKey: queryKeys.stats(),
          queryFn: readStats,
        }),
        queryClient.prefetchQuery({
          queryKey: queryKeys.authConfig(),
          queryFn: () => ({
            enabled: config.auth?.enabled ?? false,
            shareLinkDomain: config.shareLinkDomain ?? undefined,
            editableFolders: getEditableFolders(),
          }),
        }),
      )

      if ((urlPath === '/' || urlPath === '') && isKnowledgeBase) {
        prefetchPromises.push(
          queryClient.prefetchQuery({
            queryKey: queryKeys.kbRecent(dir),
            queryFn: () => getKnowledgeBaseRecentFiles(dir),
          }),
        )
      }

      await Promise.all(prefetchPromises)
      if (urlPath === '/' || urlPath === '') {
        await prefetchDirectViewerQueries(queryClient, dirParam, viewingPath, playingPath)
      }
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
            queryKey: queryKeys.shareInfo(token),
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

          if (authorized) {
            const shareDirParam = searchParams.get('dir')
            const shareDir = shareDirParam || ''
            const viewingPath = searchParams.get('viewing')
            const playingPath = searchParams.get('playing')

            if (share.isDirectory) {
              const resolvedShareDir = resolveShareSubPath(share, shareDir)
              if (resolvedShareDir) {
                await queryClient.prefetchQuery({
                  queryKey: queryKeys.shareFiles(token, shareDir),
                  queryFn: () => getSharedFiles(resolvedShareDir),
                })
              }
            }

            if (isKnowledgeBase) {
              const resolvedScopePath = resolveShareSubPath(share, shareDir)
              if (resolvedScopePath) {
                await queryClient.prefetchQuery({
                  queryKey: queryKeys.shareKbRecent(token, shareDir || undefined),
                  queryFn: () => getKnowledgeBaseRecentFiles(resolvedScopePath),
                })
              }
            }

            await prefetchShareViewerQueries(
              queryClient,
              share,
              shareDirParam,
              viewingPath,
              playingPath,
            )
          }
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
