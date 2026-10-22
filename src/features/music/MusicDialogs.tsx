import { observe, view, Portal } from 'effectweb'
import X from '@effectweb/lucide/icons/x'
import { modalFocus } from '@/lib/ui/modal-focus'
import { musicUiSource, playMusic, setMusicDialog, type MusicDialog } from './actions'
import { TrackList } from './TrackList'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
const DialogContent = view<{ request: MusicDialog }>((props) => {
  return (
    <>
      <button
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
      </button>
      <TrackList items={props.request.items} title={props.request.title} />
    </>
  )
})
export const MusicDialogs = view(() =>
  observe(musicUiSource, ({ dialog, notice }) => {
    const title = () => dialog?.title ?? ''
    return (
      <>
        {dialog ? (
          <Portal>
            <div
              class='fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-3 sm:p-6'
              role='presentation'
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setMusicDialog(null)
              }}
            >
              <div
                use={modalFocus({ onEscape: () => setMusicDialog(null) })}
                role='dialog'
                aria-modal='true'
                aria-label={title()}
                class='flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl'
              >
                <div class='flex shrink-0 items-center justify-between border-b border-border px-5 py-3'>
                  <h2 class='text-lg font-semibold'>{title()}</h2>
                  <button
                    aria-label='Close music dialog'
                    class='grid size-11 place-items-center rounded-lg hover:bg-secondary'
                    onClick={() => setMusicDialog(null)}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div class='overflow-y-auto p-5'>
                  <DialogContent request={dialog} />
                </div>
              </div>
            </div>
          </Portal>
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
