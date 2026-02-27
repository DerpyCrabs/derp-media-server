import { listDirectory, getEditableFolders } from '@/lib/file-system'
import { config } from '@/lib/config'
import { FileList } from '@/components/file-list'
import { MediaPlayers } from '@/components/media-players'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'
import { promises as fs } from 'fs'
import path from 'path'
import { getMediaType } from '@/lib/media-utils'
import { FileItem, MediaType } from '@/lib/types'
import { VIRTUAL_FOLDERS } from '@/lib/constants'

interface PageProps {
  searchParams: Promise<{ dir?: string; playing?: string }>
}

type ViewMode = 'list' | 'grid'

interface Settings {
  viewModes: Record<string, ViewMode>
  favorites: string[]
  customIcons: Record<string, string>
}

interface SettingsFile {
  [mediaDir: string]: Settings
}

async function readSettings(): Promise<Settings> {
  try {
    const mediaDir = config.mediaDir
    const settingsFile = path.join(process.cwd(), 'settings.json')
    const data = await fs.readFile(settingsFile, 'utf-8')
    const allSettings: SettingsFile = JSON.parse(data)
    return allSettings[mediaDir] || { viewModes: {}, favorites: [], customIcons: {} }
  } catch {
    return { viewModes: {}, favorites: [], customIcons: {} }
  }
}

async function getMostPlayedFiles(): Promise<FileItem[]> {
  try {
    const mediaDir = config.mediaDir
    const statsFile = path.join(process.cwd(), 'stats.json')
    const data = await fs.readFile(statsFile, 'utf-8')
    const allStats = JSON.parse(data)
    const stats = allStats[mediaDir] || { views: {} }
    const views = stats.views || {}

    // Sort files by view count (descending)
    const sortedFiles = Object.entries(views)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 50) // Limit to top 50

    // Build FileItem array
    const fileItems: FileItem[] = []
    for (const [filePath, viewCount] of sortedFiles) {
      try {
        const fullPath = path.join(mediaDir, filePath)
        const stat = await fs.stat(fullPath)

        // Skip directories
        if (stat.isDirectory()) {
          continue
        }

        const fileName = path.basename(filePath)
        const extension = path.extname(fileName).slice(1).toLowerCase()

        fileItems.push({
          name: fileName,
          path: filePath,
          type: getMediaType(extension),
          size: stat.size,
          extension,
          isDirectory: false,
          viewCount: viewCount as number,
        })
      } catch (error) {
        // Skip files that no longer exist or can't be accessed
        console.error(`Error accessing ${filePath}:`, error)
        continue
      }
    }

    return fileItems
  } catch {
    return []
  }
}

async function getFavoriteFiles(): Promise<FileItem[]> {
  try {
    const mediaDir = config.mediaDir
    const settingsFile = path.join(process.cwd(), 'settings.json')
    const data = await fs.readFile(settingsFile, 'utf-8')
    const allSettings: SettingsFile = JSON.parse(data)
    const settings = allSettings[mediaDir] || { favorites: [] }
    const favorites = settings.favorites || []

    // Build FileItem array
    const fileItems: FileItem[] = []
    for (const filePath of favorites) {
      try {
        const fullPath = path.join(mediaDir, filePath)
        const stat = await fs.stat(fullPath)

        const fileName = path.basename(filePath)
        const extension = path.extname(fileName).slice(1).toLowerCase()

        fileItems.push({
          name: fileName,
          path: filePath,
          type: stat.isDirectory() ? MediaType.FOLDER : getMediaType(extension),
          size: stat.isDirectory() ? 0 : stat.size,
          extension,
          isDirectory: stat.isDirectory(),
        })
      } catch (error) {
        // Skip files that no longer exist or can't be accessed
        console.error(`Error accessing ${filePath}:`, error)
        continue
      }
    }

    return fileItems
  } catch {
    return []
  }
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams
  const currentDir = params.dir || ''
  const playingPath = params.playing || ''

  // Check if playing file is an audio file
  const extension = playingPath.split('.').pop()?.toLowerCase()
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
  const isAudioPlaying = playingPath && audioExtensions.includes(extension || '')

  let files: Awaited<ReturnType<typeof listDirectory>> = []
  let error = null

  try {
    // Check if we're accessing a virtual folder
    if (currentDir === VIRTUAL_FOLDERS.MOST_PLAYED) {
      files = await getMostPlayedFiles()
    } else if (currentDir === VIRTUAL_FOLDERS.FAVORITES) {
      files = await getFavoriteFiles()
    } else {
      files = await listDirectory(currentDir)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to read directory'
    console.error('Error reading directory:', err)
  }

  // Read view mode and favorites from settings
  const settings = await readSettings()
  const initialViewMode: ViewMode = settings.viewModes[currentDir] || 'list'
  const initialFavorites = settings.favorites || []
  const initialCustomIcons = settings.customIcons || {}

  // Get editable folders from environment (server-side only)
  const editableFolders = getEditableFolders()

  return (
    <>
      <MediaPlayers editableFolders={editableFolders} />
      <div className={`min-h-screen flex flex-col ${isAudioPlaying ? 'pb-12' : ''}`}>
        <div className='container mx-auto lg:p-4 flex flex-col'>
          {error ? (
            <Card className='border-destructive shrink-0'>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-destructive'>
                  <AlertCircle className='h-5 w-5' />
                  Error Loading Directory
                </CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className='text-sm text-muted-foreground'>
                  Please check that mediaDir in config.jsonc is set correctly and the directory
                  exists.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className='py-0 rounded-none lg:rounded-xl'>
              <FileList
                files={files}
                currentPath={currentDir}
                initialViewMode={initialViewMode}
                initialFavorites={initialFavorites}
                initialCustomIcons={initialCustomIcons}
                editableFolders={editableFolders}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
