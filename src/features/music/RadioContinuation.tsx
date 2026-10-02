import { Effect, Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { musicStatusSource } from './enabled'
import { queryCache } from '@/lib/api/cache'
import { musicHomeQuery } from './queries'
import { postSchemaEffect } from '@/lib/api/client'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
import { musicItem } from './actions'
import { radioTracks, recordingKey } from './radio'

const radioOwner = modelOwner({ id: '', exhausted: false })
export const radioStatusSource = radioOwner.source
const setRadioStatus = radioOwner.patch
const skipSlot = 'music-skip'
type EarlySkip = { id: string; path: string }
const skipListeners = new Set<(event: EarlySkip) => void>()
export function reportEarlySkip(event: EarlySkip) {
  for (const listener of skipListeners) listener(event)
  radioOwner.run(
    skipSlot,
    postSchemaEffect(Schema.Struct({ ok: Schema.Boolean }), '/api/music/skip', event).pipe(
      Effect.ignore,
    ),
    'queue',
  )
}

export function createRadioContinuation() {
  const session = getPlaybackSession()
  let station = ''
  let recent = new Set<string>()
  let skipped = new Set<string>()
  let lastPath = ''
  let lastSignature = ''
  let updating = false
  const persist = () => {
    try {
      sessionStorage.setItem(
        'music-radio-history',
        JSON.stringify({ station, recent: [...recent], skipped: [...skipped] }),
      )
    } catch {}
  }
  function update() {
    if (updating) return
    const state = session.getSnapshot()
    const context = state.queueContext
    if (context?.kind !== 'radio' || !context.radio || !context.id) {
      lastSignature = ''
      return
    }
    if (station !== context.id) {
      station = context.id
      recent = new Set()
      skipped = new Set()
      lastPath = ''
      lastSignature = ''
      try {
        const saved = JSON.parse(sessionStorage.getItem('music-radio-history') || 'null') as {
          station: string
          recent: string[]
          skipped: string[]
        } | null
        if (
          saved?.station === station &&
          Array.isArray(saved.recent) &&
          Array.isArray(saved.skipped)
        ) {
          recent = new Set(saved.recent.filter((value) => typeof value === 'string'))
          skipped = new Set(saved.skipped.filter((value) => typeof value === 'string'))
        }
      } catch {}
    }
    const path = state.currentItem?.locator ?? ''
    if (path && path !== lastPath) {
      recent.add(path)
      lastPath = path
      persist()
    }
    const future = state.queue.slice(Math.max(0, state.currentIndex))
    if (
      !musicStatusSource.model().enabled ||
      !state.desiredPlaying ||
      future.length > 4 ||
      !state.currentItem ||
      state.phase === 'error'
    )
      return
    const signature = `${context.id}:${future.map((item) => item.locator).join('\0')}:${recent.size}:${skipped.size}`
    if (signature === lastSignature) return
    lastSignature = signature
    const known = new Set(future.map((item) => item.locator))
    const home = queryCache.getQueryData(musicHomeQuery, '')
    const excludedRecordings = new Set(
      (home?.radio.tracks || [])
        .filter(
          (track) => known.has(track.path) || recent.has(track.path) || skipped.has(track.path),
        )
        .map(recordingKey),
    )
    const additions = radioTracks(home, context.radio)
      .filter(
        (track) =>
          !known.has(track.path) &&
          !recent.has(track.path) &&
          !skipped.has(track.path) &&
          !excludedRecordings.has(recordingKey(track)),
      )
      .slice(0, 12)
      .map((track) => ({ ...musicItem(track), automatic: true }))
    setRadioStatus({ id: context.id, exhausted: additions.length === 0 })
    if (!additions.length) return
    updating = true
    try {
      const repeated = new Set(additions.map((item) => item.locator))
      const past = state.queue
        .slice(0, state.currentIndex)
        .filter((item) => !repeated.has(item.locator))
      session.dispatch({
        type: 'setQueue',
        queue: [...past, ...future, ...additions],
        current: state.currentItem,
      })
      if (state.phase === 'ended') session.dispatch({ type: 'next' })
    } finally {
      updating = false
    }
  }
  const onSkip = (event: EarlySkip) => {
    if (session.getSnapshot().queueContext?.kind !== 'radio') return
    skipped.add(event.path)
    lastSignature = ''
    persist()
    const state = session.getSnapshot()
    const kept = state.queue.filter(
      (item, index) => index <= state.currentIndex || !skipped.has(item.locator),
    )
    if (kept.length !== state.queue.length) session.dispatch({ type: 'setQueue', queue: kept })
    else update()
  }
  skipListeners.add(onSkip)
  const unsubscribe = session.subscribe(update)
  update()
  const stopStatus = musicStatusSource.subscribe(update)
  const detach = () => {
    stopStatus()
    unsubscribe()
    skipListeners.delete(onSkip)
  }
  return {
    dispose: () => {
      detach()
      radioOwner.dispose()
    },
    close: () =>
      Effect.sync(detach).pipe(
        Effect.andThen(radioOwner.awaitIdle(skipSlot)),
        Effect.ensuring(radioOwner.close().pipe(Effect.orDie)),
      ),
  }
}
