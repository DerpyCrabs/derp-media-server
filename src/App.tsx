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

export const App = view(() => (
  <>
    <PlaybackMediaHost />
    <MusicDialogs />
    <GlobalForbiddenToast />
    <AppDialogHost />
    {observe(browserHistory, (location) => {
      const reader = new URLSearchParams(location.search).get('reader')
      return (
        <>
          {location.pathname === '/desktop' ? (
            <DesktopPage />
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
