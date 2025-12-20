import { listDirectory } from '@/lib/file-system'
import { FileList } from '@/components/file-list'
import { MediaPlayers } from '@/components/media-players'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'

interface PageProps {
  searchParams: Promise<{ dir?: string; playing?: string }>
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
    files = await listDirectory(currentDir)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to read directory'
    console.error('Error reading directory:', err)
  }

  return (
    <>
      <MediaPlayers />
      <div className={`min-h-screen flex flex-col ${isAudioPlaying ? 'pb-12' : ''}`}>
        <div
          className='container mx-auto lg:p-4 flex flex-col'
          style={{ height: isAudioPlaying ? 'calc(100vh - 60px)' : '100vh' }}
        >
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
                  Please check that the MEDIA_DIR environment variable is set correctly and the directory exists.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className='flex-1 flex flex-col overflow-hidden min-h-0 py-0 rounded-none lg:rounded-xl'>
              <FileList files={files} currentPath={currentDir} />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
