import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js'

export type SubscribableClientStore = { subscribe: (listener: () => void) => () => void }

/**
 * Subscribes during the Solid component lifecycle and bumps a tick when the store updates.
 * Read `void tick()` in memos, then `store.getState()`.
 */
export function useStoreSync(store: SubscribableClientStore): Accessor<number> {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const unsub = store.subscribe(() => setTick((n) => n + 1))
    onCleanup(unsub)
  })
  return tick
}
