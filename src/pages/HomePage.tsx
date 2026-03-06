import { useQuery } from '@tanstack/react-query'
import { useUrlState } from '@/lib/use-url-state'
import { FileList } from '@/components/file-list'
import { MediaPlayers } from '@/components/media-players'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function HomePage() {
  const { urlState } = useUrlState()
  const playingPath = urlState.playing || ''

  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
  const extension = playingPath.split('.').pop()?.toLowerCase()
  const isAudioPlaying = playingPath && audioExtensions.includes(extension || '')

  const { data: authConfig } = useQuery({
    queryKey: queryKeys.authConfig(),
    queryFn: () =>
      api<{ enabled: boolean; shareLinkDomain?: string; editableFolders: string[] }>(
        '/api/auth/config',
      ),
  })
  const editableFolders = authConfig?.editableFolders ?? []

  return (
    <>
      <MediaPlayers editableFolders={editableFolders} />
      <div className={`min-h-screen flex flex-col ${isAudioPlaying ? 'pb-12' : ''}`}>
        <div className='container mx-auto lg:p-4 flex flex-col'>
          <Card className='py-0 rounded-none lg:rounded-xl'>
            <FileList files={[]} initialViewMode='list' editableFolders={editableFolders} />
          </Card>
        </div>
      </div>
    </>
  )
}
