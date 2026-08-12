import type { PlaybackSession, PlaybackSnapshot } from '@/lib/playback-session'
import { subscribeWebOfflineCatalog } from '@/src/lib/web-offline-storage'
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js'

type PlaybackContextValue = Readonly<{
  session: PlaybackSession
  snapshot: Accessor<PlaybackSnapshot>
}>

type PlaybackProviderProps = Readonly<{
  session: PlaybackSession
  children: JSX.Element
}>

const PlaybackContext = createContext<PlaybackContextValue>()

/**
 * Owns the browser lifecycle for exactly one authorized playback scope.
 * Key this component by owner/Grant scope so crossing the boundary tears down
 * the previous transport before the next scope mounts.
 */
export function PlaybackProvider(props: PlaybackProviderProps) {
  const session = props.session
  const [snapshot, setSnapshot] = createSignal(session.getSnapshot(), { equals: false })
  const value: PlaybackContextValue = Object.freeze({ session, snapshot })

  onMount(() => {
    const unsubscribe = session.subscribe(() => setSnapshot(session.getSnapshot()))
    setSnapshot(session.getSnapshot())
    const unsubscribeOfflineCatalog = subscribeWebOfflineCatalog(() => {
      const current = session.getSnapshot()
      if (
        !current.online &&
        current.currentItem &&
        current.phase === 'recoverable' &&
        current.issue === 'offlineUnavailable'
      ) {
        session.dispatch({ type: 'refreshSource' })
      }
    })
    const syncOnline = () => session.dispatch({ type: 'onlineChanged', online: navigator.onLine })
    const checkpoint = () => session.dispatch({ type: 'checkpoint' })

    syncOnline()
    window.addEventListener('online', syncOnline)
    window.addEventListener('offline', syncOnline)
    window.addEventListener('pagehide', checkpoint)

    onCleanup(() => {
      window.removeEventListener('online', syncOnline)
      window.removeEventListener('offline', syncOnline)
      window.removeEventListener('pagehide', checkpoint)
      unsubscribeOfflineCatalog()
      unsubscribe()
      session.dispatch({ type: 'teardown' })
    })
  })

  return <PlaybackContext.Provider value={value}>{props.children}</PlaybackContext.Provider>
}

export function usePlaybackSession(): PlaybackSession {
  const context = useContext(PlaybackContext)
  if (!context) throw new Error('usePlaybackSession must be used inside PlaybackProvider')
  return context.session
}

export function usePlaybackSnapshot(): Accessor<PlaybackSnapshot> {
  const context = useContext(PlaybackContext)
  if (!context) throw new Error('usePlaybackSnapshot must be used inside PlaybackProvider')
  return context.snapshot
}
