import type { UnavailablePersistedResourceTarget } from '@/lib/resource'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import LoaderCircle from 'lucide-solid/icons/loader-circle'

export function ResourceResolvingPane() {
  return (
    <div
      class='flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-background p-6 text-center text-muted-foreground'
      data-testid='resource-resolving-pane'
    >
      <LoaderCircle class='h-6 w-6 animate-spin' stroke-width={1.75} aria-hidden='true' />
      <p class='text-sm font-medium text-foreground'>Resolving saved resource</p>
      <p class='max-w-sm text-xs'>Checking current location before opening.</p>
    </div>
  )
}

export function ResourceUnavailablePane(props: { target: UnavailablePersistedResourceTarget }) {
  const sourceUnavailable = () => props.target.availability === 'sourceUnavailable'
  return (
    <div
      class='flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-background p-6 text-center text-muted-foreground'
      data-testid='resource-unavailable-pane'
      data-resource-availability={props.target.availability}
    >
      <CircleAlert class='h-6 w-6' stroke-width={1.75} aria-hidden='true' />
      <p class='text-sm font-medium text-foreground'>
        {sourceUnavailable() ? 'Source unavailable' : 'Resource unavailable'}
      </p>
      <p class='max-w-sm text-xs'>
        {sourceUnavailable()
          ? 'Reconnect source to open this saved resource.'
          : 'Saved resource no longer exists.'}
      </p>
    </div>
  )
}
