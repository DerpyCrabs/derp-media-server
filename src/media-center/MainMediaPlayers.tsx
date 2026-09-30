import { mediaSelectionSource } from '@/features/media-ai/selection'
import { observe, view } from 'effectweb'
import { browserHistory } from '@/lib/browser/browser-history'
import { ViewerPane } from '@/features/viewer'
import { AudioPlayer } from './AudioPlayer'
import { VideoPlayer } from './VideoPlayer'
import { closeViewer, viewFile } from '@/lib/browser/url-state-actions'

type Props = { editableFolders?: string[]; knowledgeBases?: string[] }

const RootViewerPane = view<Props>((props) =>
  observe(browserHistory, (location) =>
    observe(mediaSelectionSource, (selection) => {
      const params = new URLSearchParams(location.search)
      const viewingPath = params.get('viewing') ?? ''
      const directory =
        params.get('dir') ?? viewingPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      return (
        <ViewerPane
          viewingPath={viewingPath}
          imageSeed={params.get('imageSeed')}
          onImageSeedChange={(seed, path) => viewFile(path, directory || undefined, seed)}
          selection={selection.images}
          directory={directory}
          contentVisible={true}
          active={true}
          editableFolders={props.editableFolders ?? []}
          knowledgeBases={props.knowledgeBases}
          showPlayback={false}
          presentation='modal'
          onNavigateViewing={(path) =>
            viewFile(path, directory || undefined, params.get('imageSeed'))
          }
          onClose={closeViewer}
        />
      )
    }),
  ),
)

export const MainMediaPlayers = view<Props>((props) => {
  return (
    <>
      <RootViewerPane {...props} />
      <VideoPlayer />
      <AudioPlayer />
    </>
  )
})
