import { FileConflictHost } from './features/explorer/FileConflictHost'
import { SleepTimerHost } from './features/playback/SleepTimerHost'
import { observe, view } from 'effectweb'
import { browserHistory } from '@/lib/browser/browser-history'
import { MediaCenterPage } from './media-center/MediaCenterPage'
import { WorkspaceRoute } from './workspace/WorkspaceRoute'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'
import { AppDialogHost } from './lib/ui/AppDialogHost'
import { DesktopPage } from './desktop/DesktopPage'
import { ReaderDialog } from './features/reader/ReaderDialog'
import { PlaybackMediaHost } from './features/playback/PlaybackMediaHost'
import { MusicDialogs } from './features/music/MusicDialogs'

export const App = view<{ browserWindow: Window }>((props) => (
  <>
    <PlaybackMediaHost />
    <SleepTimerHost />
    <MusicDialogs />
    <GlobalForbiddenToast />
    <AppDialogHost />
    <FileConflictHost />
    {observe(browserHistory, (location) => {
      const reader = new URLSearchParams(location.search).get('reader')
      return (
        <>
          {location.pathname === '/desktop' ? (
            <DesktopPage browserWindow={props.browserWindow} />
          ) : location.pathname === '/workspace' ? (
            <WorkspaceRoute />
          ) : (
            <MediaCenterPage />
          )}
          {reader ? <ReaderDialog sourcePath={reader} /> : null}
        </>
      )
    })}
  </>
))
