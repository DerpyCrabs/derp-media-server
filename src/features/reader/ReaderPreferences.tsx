import { Effect, Semaphore } from 'effect'
import { commandSlot, modelOwner, observe, view, type JSX } from 'effectweb'
import { ApiError } from '@/lib/api/client'
import {
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferencesEffect,
  mergeReaderPreferenceChanges,
  saveReaderPreferencesEffect,
  type ReaderPreferences,
} from './reader-state-client'
const loadSlot = commandSlot('reader-preferences-load')
const saveSlot = commandSlot('reader-preferences-save')
const debounceSlot = commandSlot('reader-preferences-debounce')
const owner = modelOwner({ ready: false, preferences: DEFAULT_READER_PREFERENCES })
let revision = 0
let base: ReaderPreferences = DEFAULT_READER_PREFERENCES
let started = false
const saveGate = Semaphore.makeUnsafe(1)
const save = saveGate.withPermit(
  Effect.gen(function* () {
    const desired = owner.read().preferences
    if (JSON.stringify(desired) === JSON.stringify(base)) return
    const original = base
    let next = desired
    revision = yield* saveReaderPreferencesEffect(next, revision).pipe(
      Effect.catch((reason) => {
        if (!(reason instanceof ApiError) || reason.status !== 409) return Effect.fail(reason)
        return loadReaderPreferencesEffect.pipe(
          Effect.flatMap((latest) => {
            next = mergeReaderPreferenceChanges(latest.preferences, original, desired)
            return saveReaderPreferencesEffect(next, latest.revision)
          }),
        )
      }),
    )
    base = next
    if (owner.read().preferences === desired) owner.patch({ preferences: next })
  }),
)

export const readerPreferences = {
  source: owner.source,
  read: () => owner.read().preferences,
  start: () => {
    if (started) return
    started = true
    owner.run(
      loadSlot,
      loadReaderPreferencesEffect.pipe(
        Effect.tap((envelope) =>
          Effect.sync(() => {
            revision = envelope.revision
            base = envelope.preferences
            owner.patch({ ready: true, preferences: base })
          }),
        ),
        Effect.catch(() => Effect.sync(() => owner.patch({ ready: true }))),
      ),
      'drop',
    )
  },
  patch: (changes: Partial<ReaderPreferences>) => {
    owner.patch({ preferences: { ...owner.read().preferences, ...changes } })
    owner.run(
      debounceSlot,
      Effect.sleep(350).pipe(
        Effect.andThen(Effect.sync(() => owner.run(saveSlot, save, 'latest-queued'))),
      ),
      'replace',
    )
  },
  flush: () =>
    Effect.gen(function* () {
      owner.cancel(debounceSlot)
      yield* owner.awaitIdle(saveSlot)
      yield* save
    }),
  close: () =>
    Effect.sync(() => owner.cancel(debounceSlot)).pipe(
      Effect.andThen(owner.awaitIdle(saveSlot)),
      Effect.andThen(Effect.suspend(() => (started && owner.read().ready ? save : Effect.void))),
      Effect.ensuring(owner.close().pipe(Effect.orDie)),
    ),
  dispose: () => owner.dispose(),
}
export const ReaderPreferencesProvider = view<{ children: JSX.Element }>((props) =>
  observe(owner.source, (state) =>
    state.ready ? props.children : <div class='absolute inset-0 bg-neutral-900' />,
  ),
)
