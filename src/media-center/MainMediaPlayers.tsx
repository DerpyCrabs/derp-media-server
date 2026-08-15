import { createMemo } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '@/lib/browser/browser-history'
import { ViewerPane } from '@/features/viewer'
import { AudioPlayer } from './AudioPlayer'
import { VideoPlayer } from './VideoPlayer'
import { closeViewer, viewFile } from '@/lib/browser/url-state-actions'

type Props = {
  editableFolders?: string[]
  knowledgeBases?: string[]
}

function RootViewerPane(props: Props) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPath = createMemo(() => params().get('viewing') ?? '')
  const directory = createMemo(() => {
    const explicit = params().get('dir')
    if (explicit !== null) return explicit
    return viewingPath().replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  })

  return (
    <ViewerPane
      viewingPath={viewingPath}
      directory={directory}
      contentVisible={() => true}
      active={() => true}
      editableFolders={props.editableFolders ?? []}
      knowledgeBases={props.knowledgeBases}
      showPlayback={false}
      presentation='modal'
      onNavigateViewing={(path) => viewFile(path, directory() || undefined)}
      onClose={closeViewer}
    />
  )
}

export function MainMediaPlayers(props: Props) {
  return (
    <>
      <RootViewerPane {...props} />
      <VideoPlayer />
      <AudioPlayer />
    </>
  )
}
