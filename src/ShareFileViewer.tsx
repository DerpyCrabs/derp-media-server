import { MediaType } from '@/lib/types'
import { post } from '@/lib/api'
import Download from 'lucide-solid/icons/download'
import { Match, Switch, onCleanup, onMount } from 'solid-js'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useBrowserHistory } from './browser-history'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import type { ShareInfoPayload } from './ShareFolderBrowser'
import { useShareFileWatcher } from './lib/use-share-file-watcher'
import { playFile, viewFile } from './lib/url-state-actions'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { TextViewerBody, type TextViewerShareContext } from './media/TextViewerDialog'
import { ThemeSwitcher } from './ThemeSwitcher'

type Props = {
  token: string
  shareInfo: ShareInfoPayload
}

export function ShareFileViewer(props: Props) {
  const history = useBrowserHistory()
  useShareFileWatcher(props.token)
  useDynamicFavicon(() => ({}), {
    rootName: props.shareInfo.name,
    getSearch: () => history().search,
  })

  const shareContext = (): TextViewerShareContext => ({
    token: props.token,
    sharePath: props.shareInfo.path,
    isDirectory: props.shareInfo.isDirectory,
  })

  const shareCanEdit = () =>
    props.shareInfo.editable && props.shareInfo.restrictions?.allowEdit !== false

  onMount(() => {
    useMediaPlayer.getState().setShareContext(props.token, props.shareInfo.path)
    void post(`/api/share/${props.token}/view`, {}).catch(() => {})

    const mt = props.shareInfo.mediaType
    if (mt === MediaType.AUDIO || mt === MediaType.VIDEO) {
      playFile(props.shareInfo.path)
    } else if (mt === MediaType.IMAGE || mt === MediaType.PDF) {
      viewFile(props.shareInfo.path)
    }
  })

  onCleanup(() => {
    useMediaPlayer.getState().clearShareContext()
  })

  return (
    <>
      <ThemeSwitcher variant='floating' />
      <Switch>
        <Match when={props.shareInfo.mediaType === MediaType.TEXT}>
          <>
            <MainMediaPlayers
              shareContext={shareContext()}
              shareCanEdit={shareCanEdit()}
              editableFolders={[]}
            />
            <TextViewerBody
              viewingPath={props.shareInfo.path}
              shareContext={shareContext()}
              editableFolders={[]}
              shareCanEdit={shareCanEdit()}
            />
          </>
        </Match>
        <Match
          when={
            props.shareInfo.mediaType === MediaType.IMAGE ||
            props.shareInfo.mediaType === MediaType.PDF ||
            props.shareInfo.mediaType === MediaType.VIDEO ||
            props.shareInfo.mediaType === MediaType.AUDIO
          }
        >
          <div class='min-h-screen'>
            <MainMediaPlayers
              shareContext={shareContext()}
              shareCanEdit={shareCanEdit()}
              editableFolders={[]}
            />
          </div>
        </Match>
        <Match when={true}>
          <>
            <MainMediaPlayers
              shareContext={shareContext()}
              shareCanEdit={shareCanEdit()}
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
