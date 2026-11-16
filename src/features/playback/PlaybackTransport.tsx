import { view } from 'effectweb'
import { Button } from '@/lib/ui/button'
import Pause from '@effectweb/lucide/icons/pause'
import Play from '@effectweb/lucide/icons/play'
import StepBack from '@effectweb/lucide/icons/step-back'
import StepForward from '@effectweb/lucide/icons/step-forward'
import Square from '@effectweb/lucide/icons/square'

type Props = {
  playing: boolean
  canPrevious: boolean
  canToggle: boolean
  canNext: boolean
  busy?: boolean
  onPrevious: () => void
  onToggle: () => void
  onNext: () => void
  canStop?: boolean
  onStop?: () => void
}

// Presentation shared by the workspace player and desktop MPRIS adapters.
export const PlaybackTransport = view<Props>((props) => (
  <>
    <Button
      size='icon'
      variant='ghost'
      type='button'
      class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
      disabled={props.busy || !props.canPrevious}
      data-media-action='previous'
      aria-label='Previous track'
      title='Previous track'
      onClick={props.onPrevious}
    >
      <StepBack class='size-4' stroke-width={2} />
    </Button>
    <Button
      size='icon'
      variant='default'
      type='button'
      data-media-action='play-pause'
      aria-label={props.playing ? 'Pause' : 'Play'}
      title={props.playing ? 'Pause' : 'Play'}
      class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
      disabled={props.busy || !props.canToggle}
      onClick={props.onToggle}
    >
      {props.playing ? <Pause class='size-4' /> : <Play class='size-4' />}
    </Button>
    <Button
      size='icon'
      variant='ghost'
      type='button'
      class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
      disabled={props.busy || !props.canNext}
      data-media-action='next'
      aria-label='Next track'
      title='Next track'
      onClick={props.onNext}
    >
      <StepForward class='size-4' stroke-width={2} />
    </Button>
    {props.onStop ? (
      <Button
        type='button'
        size='icon'
        variant='ghost'
        class='size-8 shrink-0'
        data-media-action='stop'
        aria-label='Stop'
        title='Stop'
        disabled={props.busy || !props.canStop}
        onClick={props.onStop}
      >
        <Square class='size-4' stroke-width={2} />
      </Button>
    ) : null}
  </>
))
