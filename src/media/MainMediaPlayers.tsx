import type { ResourceContentInstance } from '@/lib/domain/content'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { Show, createMemo } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { ContentRuntimeView } from '../features/content/ContentRuntimeView'
import {
  legacyFilesystemContentInstance,
  legacyFilesystemPathForContent,
} from '../integrations/filesystem/legacy-content'
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
  const directory = createMemo(() => params().get('dir') ?? '')
  const content = createMemo<ResourceContentInstance | null>(() => {
    const path = params().get('viewing')
    if (!path) return null
    const type = getMediaTypeFromPath(path)
    if (type === MediaType.AUDIO || type === MediaType.VIDEO) return null
    return legacyFilesystemContentInstance({
      id: 'library-viewer',
      path,
      surface: 'library',
      disposition: type === MediaType.PDF || type === MediaType.BOOK ? 'fullscreen' : 'modal',
      contextPath: directory() || undefined,
    })
  })

  return (
    <>
      <Show when={content()}>
        <div
          role='dialog'
          aria-modal='true'
          data-testid='content-runtime-viewer'
          class='fixed inset-0 z-[70] min-h-0 overflow-hidden bg-background'
        >
          <ContentRuntimeView
            runtime={applicationContentRuntime}
            instance={content}
            onReplace={(next) => {
              if (next.type !== 'resource') return
              const path = legacyFilesystemPathForContent(next)
              if (path !== null) viewFile(path, directory())
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
