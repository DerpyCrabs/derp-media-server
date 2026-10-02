import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { HermesChatPaneProps } from './HermesChatPane'

export const HermesChatPane = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./HermesChatPane')),
      (module) => module.HermesChatPane,
    ),
  {
    pending: view<HermesChatPaneProps>(() => (
      <div class='relative flex h-full min-h-0 flex-col bg-background text-[13px] text-foreground' />
    )),
    failure: view(() => (
      <div class='relative flex h-full min-h-0 flex-col bg-background text-[13px] text-foreground'>
        <p role='alert' class='p-4 text-sm text-muted-foreground'>
          Unable to load chat. Reload the page to try again.
        </p>
      </div>
    )),
  },
)
