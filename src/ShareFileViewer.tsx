import { MediaType } from '@/lib/types'
import { post } from '@/lib/api'
import Download from 'lucide-solid/icons/download'
import { Match, Switch, createMemo, onCleanup, onMount } from 'solid-js'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useBrowserHistory } from './browser-history'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import type { ShareInfoPayload } from './ShareFolderBrowser'
import { useShareFileWatcher } from './lib/use-share-file-watcher'
import { playFile, viewFile } from './lib/url-state-actions'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { TextViewerBody, type TextViewerShareContext } from './media/TextViewerDialog'
import { ThemeSwitcher } from './ThemeSwitcher'
import { grantOpenScope, resourceForFileItem } from './lib/legacy-resource-adapter'
import { executeOpenPlan, openResource } from './lib/open-resource'

type Props = {
  token: string
  shareInfo: ShareInfoPayload
}

export function ShareFileViewer(props: Props) {
  const history = useBrowserHistory()
  useShareFileWatcher(() => props.token)
  useDynamicFavicon(() => ({}), {
    rootName: () => props.shareInfo.name,
    getSearch: () => history().search,
  })

  const shareContext = (): TextViewerShareContext => ({
    token: props.token,
    sharePath: props.shareInfo.path,
    isDirectory: props.shareInfo.isDirectory,
  })

  const shareCanEdit = () =>
    props.shareInfo.editable && props.shareInfo.restrictions?.allowEdit !== false
  const shareCanUpload = () =>
    props.shareInfo.editable && props.shareInfo.restrictions?.allowUpload !== false

  const plannedOpen = createMemo(() => {
    const resource = resourceForFileItem({
      name: props.shareInfo.name,
      path: props.shareInfo.path,
      type: props.shareInfo.mediaType as MediaType,
      size: 0,
      extension: props.shareInfo.extension,
      isDirectory: false,
      resource: props.shareInfo.resource,
    })
    return openResource(resource, 'default', {
      surface: 'share',
      scope: grantOpenScope(props.token),
    })
  })
  const plannedViewerId = () => {
    const plan = plannedOpen()
    return plan.kind === 'viewer' ? plan.viewer.id : null
  }

  onMount(() => {
    useMediaPlayer.getState().setShareContext(props.token, props.shareInfo.path)
    void post(`/api/share/${props.token}/view`, {}).catch(() => {})

    const plan = plannedOpen()
    executeOpenPlan(plan, (planned) => {
      if (planned.kind === 'playback') {
        useMediaPlayer.getState().playFile(props.shareInfo.path, planned.media)
        playFile(props.shareInfo.path)
      } else if (
        planned.kind === 'viewer' &&
        (planned.viewer.id === 'image-viewer' ||
          planned.viewer.id === 'pdf-reader' ||
          planned.viewer.id === 'book-reader')
      ) {
        viewFile(props.shareInfo.path, undefined, planned.viewer.id)
      }
    })
  })

  onCleanup(() => {
    useMediaPlayer.getState().clearShareContext()
  })

  return (
    <>
      <ThemeSwitcher variant='floating' />
      <Switch>
        <Match when={plannedViewerId() === 'text-viewer'}>
          <>
            <MainMediaPlayers
              shareContext={shareContext()}
              shareCanEdit={shareCanEdit()}
              shareCanUpload={shareCanUpload()}
              editableFolders={[]}
              knowledgeBases={
                props.shareInfo.knowledgeBaseRoot ? [props.shareInfo.knowledgeBaseRoot] : []
              }
            />
            <TextViewerBody
              viewingPath={props.shareInfo.path}
              shareContext={shareContext()}
              editableFolders={[]}
              knowledgeBases={
                props.shareInfo.knowledgeBaseRoot ? [props.shareInfo.knowledgeBaseRoot] : []
              }
              shareCanEdit={shareCanEdit()}
              shareCanUpload={shareCanUpload()}
            />
          </>
        </Match>
        <Match
          when={
            plannedOpen().kind === 'playback' ||
            plannedViewerId() === 'image-viewer' ||
            plannedViewerId() === 'pdf-reader' ||
            plannedViewerId() === 'book-reader'
          }
        >
          <div class='min-h-screen'>
            <MainMediaPlayers
              shareContext={shareContext()}
              shareCanEdit={shareCanEdit()}
              shareCanUpload={shareCanUpload()}
              editableFolders={[]}
            />
          </div>
        </Match>
        <Match when={true}>
          <>
            <MainMediaPlayers
              shareContext={shareContext()}
              shareCanEdit={shareCanEdit()}
              shareCanUpload={shareCanUpload()}
              editableFolders={[]}
            />
            <div class='flex min-h-screen flex-col items-center justify-center p-8'>
              <div class='max-w-md w-full space-y-6 text-center'>
                <h2 class='text-2xl font-medium'>{props.shareInfo.name}</h2>
                <p class='text-muted-foreground text-sm'>This file type cannot be previewed.</p>
                <button
                  type='button'
                  class='bg-primary text-primary-foreground hover:bg-primary/90 mx-auto inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium'
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = `/api/share/${props.token}/download`
                    a.download = props.shareInfo.name
                    a.click()
                  }}
                >
                  <Download class='h-4 w-4' stroke-width={2} />
                  Download File
                </button>
              </div>
            </div>
          </>
        </Match>
      </Switch>
    </>
  )
}
