import { NativeFileMenu } from '@/desktop/NativeOpen'
import { view } from 'effectweb'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { Button } from '@/lib/ui/button'
import { type MenuEntry } from '@/lib/ui/menu'
import { openSleepTimer, sleepTimerLabel } from './sleep-timer'
import type { PlaybackSleepTimer } from './types'
export const AudioPlaybackMenu = view<{
  path?: string
  rate: number
  timer: PlaybackSleepTimer | null
  disabled?: boolean
  onRate: (rate: number) => void
  items?: readonly MenuEntry[]
}>((props) => (
  <NativeFileMenu
    path={props.path}
    aria-label='Playback options'
    align='end'
    trigger={
      <Button variant='ghost' size='icon' aria-label='Playback options' disabled={props.disabled}>
        <Ellipsis />
      </Button>
    }
    items={[
      ...(props.items ?? []),
      {
        kind: 'submenu',
        label: `Speed · ${props.rate}×`,
        items: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((rate) => ({
          kind: 'radio' as const,
          label: `${rate}×`,
          value: String(rate),
          checked: rate === props.rate,
          onSelect: () => props.onRate(rate),
        })),
      },
      { kind: 'item', label: sleepTimerLabel(props.timer), onSelect: () => openSleepTimer() },
    ]}
  />
))
