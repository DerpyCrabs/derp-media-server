import {
  createContext,
  createSignal,
  onCleanup,
  untrack,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js'
import {
  createMediaElementHost,
  type MediaElementHost,
  type PlaybackSession,
  type PlaybackSnapshot,
} from './index'

type PlaybackContextValue = Readonly<{
  session: PlaybackSession
  snapshot: Accessor<PlaybackSnapshot>
  mediaHost: MediaElementHost
}>

type PlaybackProviderProps = Readonly<{
  session: PlaybackSession
  children: JSX.Element
}>

const PlaybackContext = createContext<PlaybackContextValue>()

export function PlaybackProvider(props: PlaybackProviderProps) {
  const session = untrack(() => props.session)
  const mediaHost = createMediaElementHost(session)
  const [snapshot, setSnapshot] = createSignal(session.getSnapshot(), { equals: false })
  const value = Object.freeze({ session, snapshot, mediaHost })

  onMount(() => {
    const unsubscribe = session.subscribe(() => setSnapshot(session.getSnapshot()))
    const checkpoint = () => session.dispatch({ type: 'checkpoint' })
    window.addEventListener('pagehide', checkpoint)
    onCleanup(() => {
      window.removeEventListener('pagehide', checkpoint)
      unsubscribe()
      mediaHost.dispose()
      session.dispatch({ type: 'destroy' })
    })
  })

  return <PlaybackContext.Provider value={value}>{props.children}</PlaybackContext.Provider>
}

function requiredPlaybackContext(): PlaybackContextValue {
  const context = useContext(PlaybackContext)
  if (!context) throw new Error('Playback context is unavailable')
  return context
}

export function usePlaybackSession(): PlaybackSession {
  return requiredPlaybackContext().session
}

export function usePlaybackSnapshot(): Accessor<PlaybackSnapshot> {
  return requiredPlaybackContext().snapshot
}

export function usePlaybackMediaHost(): MediaElementHost {
  return requiredPlaybackContext().mediaHost
}
