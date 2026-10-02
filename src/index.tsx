import { desktopOperations } from './desktop/operations'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './globals.css'
import { Effect } from 'effect'
import { makeMount, modelOwner } from 'effectweb'
import { App } from './App'
import { createPlaybackPathMutationLifetime } from './features/playback/path-mutation-lifetime'
import { initializePlayback } from './features/playback/PlaybackProvider'
import { createOwnerBrowserPlaybackSession } from './features/playback/browser-session'
import { createRadioContinuation } from './features/music/RadioContinuation'
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
    yield* own(() => desktopOperations)
    yield* own(createBrowserHistoryLifetime)
    yield* own(createThemeLifetime)
    yield* own(createClientPreferencesLifetime)
    yield* own(createHermesLifetime)
    yield* own(() => readerPreferences)
    yield* own(() => initializePlayback(createOwnerBrowserPlaybackSession()))
    yield* own(createPlaybackPathMutationLifetime)
    yield* own(() => musicUiLifetime)
    yield* own(initializeMusicStatus)
    yield* own(createRadioContinuation)
    const owner = yield* own(() => modelOwner({}))
    const root = document.getElementById('root')
    if (!root) return
    yield* makeMount(root, App, owner.source)
    yield* Effect.never
  }),
)
Effect.runFork(application)
