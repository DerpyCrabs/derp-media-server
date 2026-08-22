import { MediaCenterFileBrowser } from './MediaCenterFileBrowser'
import { MainMediaPlayers } from './MainMediaPlayers'
import { useServerConfigQuery } from '@/lib/api/use-app-data'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import { cn } from '@/lib/ui/cn'

export function MediaCenterPage() {
  const config = useServerConfigQuery()
  const { knowledgeBases } = useExplorerSettings()
  const playback = usePlaybackSnapshot()
  const editableFolders = () => config.data?.editableFolders ?? []
  const audioPlayerVisible = () => !!playback().currentItem && playback().mode === 'audio'

  return (
    <div class='min-h-screen bg-background'>
      <MainMediaPlayers editableFolders={editableFolders()} knowledgeBases={knowledgeBases()} />
      <div
        class={cn(
          audioPlayerVisible() &&
            'max-[649px]:pb-[calc(2.875rem+env(safe-area-inset-bottom,0px))] min-[650px]:pb-12',
        )}
        data-testid='media-chrome-pad-root'
      >
        <MediaCenterFileBrowser />
      </div>
    </div>
  )
}
