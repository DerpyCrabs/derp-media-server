import type { PlaybackSleepTimer } from './types'
const requests = new Set<(mount?: HTMLElement) => void>()
export function openSleepTimer(mount?: HTMLElement) {
  for (const open of requests) open(mount)
}
export function onSleepTimer(open: (mount?: HTMLElement) => void) {
  requests.add(open)
  return () => {
    requests.delete(open)
  }
}
export function sleepTimerLabel(timer: PlaybackSleepTimer | null | undefined): string {
  if (!timer) return 'Sleep timer…'
  if (timer.kind === 'expired') return 'Sleep timer · finished'
  if (timer.kind === 'end') return 'Sleep timer · end of this item'
  return `Sleep timer · until ${new Date(timer.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
