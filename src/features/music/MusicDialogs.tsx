import { Button } from '@/lib/ui/button'
import { observe, view, Portal } from 'effectweb'
import { Dialog } from '@/lib/ui/dialog'
import { musicUiSource, playMusic, setMusicDialog, type MusicDialog } from './actions'
import { PlaylistDialog } from './PlaylistDialog'
import { openPlaylists } from './actions'
import { TrackList } from './TrackList'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
const DialogContent = view<{ request: MusicDialog }>((props) => {
  return (
    <>
      <Button
        variant='default'
        class='min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90'
        onClick={() => {
          playMusic(getPlaybackSession(), props.request.items, {
            kind: 'manual',
            title: props.request.title,
          })
          setMusicDialog(null)
        }}
      >
        Play all
      </Button>
      <Button
        variant='ghost'
        class='ml-2 min-h-11 rounded-lg px-4 text-sm hover:bg-secondary'
        onClick={() =>
          openPlaylists(
            props.request.items.map((track) => track.path),
            props.request.title,
          )
        }
      >
        Add to playlist…
      </Button>
      <TrackList items={props.request.items} title={props.request.title} />
    </>
  )
})
export const MusicDialogs = view(() =>
  observe(musicUiSource, ({ dialog, notice, playlists }) => {
    const title = () => dialog?.title ?? ''
    return (
      <>
        {playlists ? <PlaylistDialog request={playlists} /> : null}
        {dialog ? (
          <Dialog
            open
            title={title()}
            onOpenChange={(open) => {
              if (!open) setMusicDialog(null)
            }}
            class='sm:max-w-2xl max-h-[90dvh] overflow-y-auto'
          >
            <DialogContent request={dialog} />
          </Dialog>
        ) : null}
        {notice ? (
          <Portal>
            <div
              role='status'
              class='fixed right-4 bottom-24 z-[30000] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-xl'
            >
              {notice}
            </div>
          </Portal>
        ) : null}
      </>
    )
  }),
)
