import { Switch, Match, Show, createMemo, lazy } from 'solid-js'
import { useBrowserHistory } from '@/lib/browser/browser-history'
import { SolidThemeSync } from './SolidThemeSync'
import { MediaCenterPage } from './media-center/MediaCenterPage'
import { WorkspaceRoute } from './workspace/WorkspaceRoute'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'
import { AppDialogHost } from './lib/ui/AppDialogHost'

const ReaderDialog = lazy(() =>
  import('./features/reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

export function App() {
  const loc = useBrowserHistory()
  const path = createMemo(() => loc().pathname)

  return (
    <>
      <GlobalForbiddenToast />
      <AppDialogHost />
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
            <WorkspaceRoute />
          </>
        </Match>
      </Switch>
      <Show when={new URLSearchParams(loc().search).get('reader')} keyed>
        {(sourcePath) => <ReaderDialog sourcePath={sourcePath} />}
      </Show>
    </>
  )
}
