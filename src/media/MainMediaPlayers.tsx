import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { Show, createMemo, createResource } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { ContentRuntimeView } from '../features/content/ContentRuntimeView'
import {
  filesystemContentInstance,
  filesystemPathForContent,
} from '../integrations/filesystem/content'
import { filesystemPathForResourceKey } from '../integrations/filesystem/resource'
import { explorerLocationFromQuery } from '../integrations/explorer-adapter'
import { applicationContentRuntime } from '../integrations/registry'
import { closeViewer, viewFile } from '../lib/url-state-actions'
import { AudioPlayer } from './AudioPlayer'
import { VideoPlayer } from './VideoPlayer'

type Props = {
  editableFolders?: string[]
  knowledgeBases?: string[]
}

export function MainMediaPlayers(_props: Props) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const directory = createMemo(
    () => filesystemPathForResourceKey(explorerLocationFromQuery(params()).key) ?? '',
  )
  const contentRequest = createMemo(() => {
    const path = params().get('viewing')
    if (!path) return null
    const type = getMediaTypeFromPath(path)
    if (type === MediaType.AUDIO || type === MediaType.VIDEO) return null
    return {
      id: 'library-viewer',
      path,
      surface: 'library',
      disposition: type === MediaType.PDF || type === MediaType.BOOK ? 'fullscreen' : 'modal',
      contextPath: directory() || undefined,
    } as const
  })
  const [content] = createResource(contentRequest, filesystemContentInstance)
  const visibleContent = createMemo(() => (contentRequest() ? (content() ?? null) : null))

  return (
    <>
      <Show when={visibleContent()}>
        <div
          role='dialog'
          aria-modal='true'
          data-testid='content-runtime-viewer'
          class='fixed inset-0 z-[70] min-h-0 overflow-hidden bg-background'
        >
          <ContentRuntimeView
            runtime={applicationContentRuntime}
            instance={visibleContent}
            onReplace={(next) => {
              if (next.type !== 'resource') return
              const path = filesystemPathForContent(next)
              if (path !== null) viewFile(path)
            }}
            onClose={closeViewer}
          />
        </div>
      </Show>
      <VideoPlayer />
      <AudioPlayer />
    </>
  )
}
