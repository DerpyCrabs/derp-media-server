import { Show } from 'solid-js'
import { Portal } from '@solidjs/web'
import { X } from 'lucide-solid'
import { useModalFocus } from '@/lib/ui/modal-focus'
import { musicDialog, musicNotice, playMusic, setMusicDialog, type MusicDialog } from './actions'
import { TrackList } from './TrackList'
import { usePlaybackSession } from '@/features/playback/PlaybackProvider'

function DialogContent(props: { request: MusicDialog }) {
  const session = usePlaybackSession()
  return (
    <>
      <button
        class='min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90'
        onClick={() => {
          playMusic(session, props.request.items, { kind: 'manual', title: props.request.title })
          setMusicDialog(null)
        }}
      >
        Play all
      </button>
      <TrackList items={props.request.items} title={props.request.title} />
    </>
  )
}

export function MusicDialogs() {
  let element: HTMLDivElement | undefined
  const onKeyDown = useModalFocus({
    active: () => musicDialog() != null,
    element: () => element,
    onEscape: () => setMusicDialog(null),
  })
  const title = () => {
    const request = musicDialog()
    return request?.title ?? ''
  }
  return (
    <>
      <Show when={musicDialog()} keyed>
        {(request) => (
          <Portal>
            <div
              class='fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-3 sm:p-6'
              role='presentation'
              onKeyDown={onKeyDown}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setMusicDialog(null)
              }}
            >
              <div
                ref={(node) => {
                  element = node
                }}
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
                  <DialogContent request={request} />
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
      <Show when={musicNotice()}>
        <Portal>
          <div
            role='status'
            class='fixed right-4 bottom-24 z-[30000] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-xl'
          >
            {musicNotice()}
          </div>
        </Portal>
      </Show>
    </>
  )
}
