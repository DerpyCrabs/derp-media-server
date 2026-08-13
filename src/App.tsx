import { Switch, Match, Show, createMemo, lazy } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { SolidThemeSync } from './SolidThemeSync'
import { FileBrowser } from './FileBrowser'
import { WorkspacePage } from './WorkspacePage'
import { CanvasPage } from './CanvasPage'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'

const ReaderDialog = lazy(() =>
  import('./reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
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
            <FileBrowser />
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
