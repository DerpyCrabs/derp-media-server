import { createAppSurfaceRuntime } from './desktop/RuntimeSurface'
import { PlaybackMediaHost } from './features/playback/PlaybackMediaHost'
import { createDesktopMediaFocus } from './desktop/media-focus'
import { getPlaybackSession } from './features/playback/PlaybackProvider'
import { createDesktopOperationsLifetime } from './desktop/operations'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './globals.css'
import { Effect, Fiber } from 'effect'
import { makeMount, modelOwner } from 'effectweb'
import { App } from './App'
import { createPlaybackPathMutationLifetime } from './features/playback/path-mutation-lifetime'
import { initializePlayback } from './features/playback/PlaybackProvider'
import { createOwnerBrowserPlaybackSession } from './features/playback/browser-session'
import { createRadioContinuation } from './features/music/RadioContinuation'
import { browserDownloadsLifetime } from './lib/files/download-blob'
import { musicUiLifetime } from './features/music/actions'
import { initializeMusicStatus } from './features/music/enabled'
import { createBrowserHistoryLifetime } from './lib/browser/browser-history'
import { createThemeLifetime } from './lib/state/theme-lifetime'
import { appDialogs } from './lib/ui/app-dialog'
import { queryCache } from './lib/api/cache'
import { createHermesLifetime } from './features/hermes/hermes-session-store'
import { createClientPreferencesLifetime } from './workspace/shared/client-preferences-store'
import { readerPreferences } from './features/reader/ReaderPreferences'

const application = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => queryCache.close())
    const own = <T extends { dispose(): void; close?: () => Effect.Effect<void, unknown> }>(
      create: () => T,
    ) =>
      Effect.acquireRelease(Effect.sync(create), (value) =>
        value.close ? value.close().pipe(Effect.orDie) : Effect.sync(() => value.dispose()),
      )
    yield* own(() => appDialogs)
    yield* own(createDesktopOperationsLifetime)
    yield* own(createBrowserHistoryLifetime)
    yield* own(createThemeLifetime)
    yield* own(createClientPreferencesLifetime)
    yield* own(createHermesLifetime)
    yield* own(() => readerPreferences)
    yield* own(() => initializePlayback(createOwnerBrowserPlaybackSession()))
    yield* own(createPlaybackPathMutationLifetime)
    yield* own(() => musicUiLifetime)
    yield* own(() => browserDownloadsLifetime)
    yield* own(initializeMusicStatus)
    yield* own(createRadioContinuation)
    const root = document.getElementById('root')
    if (!root) return undefined
    if (window.derpRuntime) {
      yield* own(() => createDesktopMediaFocus(getPlaybackSession()))
      yield* makeMount(root, PlaybackMediaHost, {})
      const runtime = createAppSurfaceRuntime(document)
      yield* Effect.addFinalizer(() => Effect.promise(() => runtime.close()))
      window.derpRuntime.register(runtime.mount, runtime.unmount, shutdownApplication)
    } else {
      const owner = yield* own(() => modelOwner({ browserWindow: window }))
      yield* makeMount(root, App, owner.source)
    }
    return yield* Effect.never
  }),
)
const applicationFiber = Effect.runFork(application)

function shutdownApplication() {
  return Effect.runPromise(Fiber.interrupt(applicationFiber))
}
