import { Effect } from 'effect'
import { controllerView, domBinding, modelOwner, ownerController, view } from 'effectweb'
import Play from '@effectweb/lucide/icons/play'
import Pause from '@effectweb/lucide/icons/pause'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import VolumeX from '@effectweb/lucide/icons/volume-x'
import { Button } from '@/lib/ui/button'
import { MusicArtwork } from '@/features/music/MusicArtwork'
import { cn } from '@/lib/ui/cn'
import { PlaybackScrubber } from '@/features/playback/create-playback-scrubber'
import { createMediaFocus } from '@/features/playback/media-focus'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'

type Props = { src: string; kind: 'audio' | 'video'; onError: () => void }
const time = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
const mountMedia = (
  element: HTMLMediaElement,
  current: () => { attach: (element: HTMLMediaElement) => () => void },
) => current().attach(element)
export const ArchiveMediaPreview = controllerView(
  {
    identity: (props: Props) => props.src,
    controller: (props: Props) => {
      const owner = modelOwner({ props, playing: false, position: 0, duration: 0, muted: false })
      let media: HTMLMediaElement | undefined
      return {
        ...ownerController(owner),
        attach: (element: HTMLMediaElement) => {
          media = element
          const session = getPlaybackSession()
          const sync = () =>
            owner.patch({
              playing: !element.paused,
              position: element.currentTime,
              duration: Number.isFinite(element.duration) ? element.duration : 0,
              muted: element.muted,
            })
          const events = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'volumechange']
          const play = () => session.dispatch({ type: 'pause' })
          const error = () => owner.read().props.onError()
          for (const event of events) element.addEventListener(event, sync)
          element.addEventListener('play', play)
          element.addEventListener('error', error)
          const stop = session.subscribe(() => {
            if (session.getSnapshot().desiredPlaying) element.pause()
          })
          const focus = createMediaFocus({
            isPlaying: () => !element.paused,
            pause: () => element.pause(),
            subscribe: (listener) => {
              for (const event of ['play', 'pause', 'ended'])
                element.addEventListener(event, listener)
              return () => {
                for (const event of ['play', 'pause', 'ended'])
                  element.removeEventListener(event, listener)
              }
            },
          })
          sync()
          return () => {
            stop()
            focus.dispose()
            for (const event of events) element.removeEventListener(event, sync)
            element.removeEventListener('play', play)
            element.removeEventListener('error', error)
            element.pause()
            element.removeAttribute('src')
            element.load()
            if (media === element) media = undefined
          }
        },
        toggle: () => {
          const element = media
          if (!element) return
          if (!element.paused) element.pause()
          else
            owner.run(
              'play',
              Effect.tryPromise(() => element.play()).pipe(
                Effect.catch(() => Effect.sync(() => owner.read().props.onError())),
              ),
              'drop',
            )
        },
        seek: (position: number) => {
          if (media) media.currentTime = position
        },
        mute: () => {
          if (media) media.muted = !media.muted
        },
      }
    },
  },
  view((model) => (
    <div
      class={cn(
        'flex h-full min-h-0 w-full flex-col justify-center bg-background',
        model.props.kind === 'audio' && 'mx-auto max-w-lg gap-6 px-4',
      )}
    >
      {model.props.kind === 'video' ? (
        <video
          use={domBinding(model.actions, mountMedia)}
          src={model.props.src}
          preload='metadata'
          playsinline
          aria-label='Archive video preview'
          class='min-h-0 w-full flex-1 bg-black object-contain'
        />
      ) : (
        <>
          <MusicArtwork class='mx-auto size-40' />
          <audio
            use={domBinding(model.actions, mountMedia)}
            src={model.props.src}
            preload='metadata'
            aria-label='Archive audio preview'
          />
        </>
      )}
      <div
        class={cn(
          'flex shrink-0 items-center gap-2 px-3 py-2',
          model.props.kind === 'video' && 'border-t border-border',
        )}
      >
        <Button
          size='icon'
          variant='outline'
          aria-label={model.playing ? 'Pause preview' : 'Play preview'}
          onClick={model.actions.toggle}
        >
          {model.playing ? <Pause /> : <Play />}
        </Button>
        <PlaybackScrubber
          itemKey={model.props.src}
          duration={model.duration}
          position={model.position}
          onSeek={model.actions.seek}
          ariaLabel='Seek preview'
          class='min-w-0 flex-1'
          ariaValueText={time}
        />
        <span class='whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
          {time(model.position)} / {time(model.duration)}
        </span>
        <Button
          size='icon'
          variant='ghost'
          aria-label={model.muted ? 'Unmute preview' : 'Mute preview'}
          onClick={model.actions.mute}
        >
          {model.muted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>
    </div>
  )),
)
