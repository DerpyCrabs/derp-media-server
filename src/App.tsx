import { Switch, Match, Show, createMemo, lazy } from 'solid-js'
import { useBrowserHistory } from '@/lib/browser/browser-history'
import { SolidThemeSync } from './SolidThemeSync'
import { MediaCenterPage } from './media-center/MediaCenterPage'
import { WorkspacePage } from './workspace/WorkspacePage'
import { CanvasPage } from './canvas/CanvasPage'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'

const ReaderDialog = lazy(() =>
  import('./features/reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

export function App() {
  const loc = useBrowserHistory()
  const path = createMemo(() => loc().pathname)

  return (
    <>
      <GlobalForbiddenToast />
      <Switch
        fallback={
          <>
            <SolidThemeSync />
            <MediaCenterPage />
          </>
        }
      >
        <Match when={path() === '/workspace'}>
          <>
            <SolidThemeSync />
            <WorkspacePage />
          </>
        </Match>
        <Match when={path() === '/canvas'}>
          <>
            <SolidThemeSync />
            <CanvasPage />
          </>
        </Match>
      </Switch>
      <Show when={new URLSearchParams(loc().search).get('reader')} keyed>
        {(sourcePath) => <ReaderDialog sourcePath={sourcePath} />}
      </Show>
    </>
  )
}
