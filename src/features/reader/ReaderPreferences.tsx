import { ApiError } from '@/lib/api/client'
import {
  createContext,
  createEffect,
  createSignal,
  Show,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
  type Setter,
} from 'solid-js'
import type { JSX } from '@solidjs/web'
import {
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferences,
  mergeReaderPreferenceChanges,
  saveReaderPreferences,
  type BookAppearance,
  type ReaderAiDetail,
  type ReaderPreferences,
} from './reader-state-client'
import type { ReaderDefaultAction, ReaderSelectionMode } from './reader-position'

type ReaderPreferencesContextValue = {
  bookAppearance: Accessor<BookAppearance>
  setBookAppearance: Setter<BookAppearance>
  selectionMode: Accessor<ReaderSelectionMode>
  setSelectionMode: Setter<ReaderSelectionMode>
  defaultAction: Accessor<ReaderDefaultAction>
  setDefaultAction: Setter<ReaderDefaultAction>
  aiDetail: Accessor<ReaderAiDetail>
  setAiDetail: Setter<ReaderAiDetail>
  outlineOpen: Accessor<boolean>
  setOutlineOpen: Setter<boolean>
  flush: () => Promise<void>
}

const ReaderPreferencesContext = createContext<ReaderPreferencesContextValue>()

export function ReaderPreferencesProvider(props: { children: JSX.Element }) {
  const [ready, setReady] = createSignal(false)
  const [bookAppearance, setBookAppearance] = createSignal({
    ...DEFAULT_READER_PREFERENCES.bookAppearance,
  })
  const [selectionMode, setSelectionMode] = createSignal<ReaderSelectionMode>('text')
  const [defaultAction, setDefaultAction] = createSignal<ReaderDefaultAction>('define')
  const [aiDetail, setAiDetail] = createSignal<ReaderAiDetail>('compact')
  const [outlineOpen, setOutlineOpen] = createSignal(true)
  let revision = 0
  let generation = 0
  let timer: number | undefined
  let disposed = false
  let queue: Promise<void> = Promise.resolve()
  let base: ReaderPreferences = {
    ...DEFAULT_READER_PREFERENCES,
    bookAppearance: { ...DEFAULT_READER_PREFERENCES.bookAppearance },
  }

  const read = (): ReaderPreferences => ({
    bookAppearance: { ...bookAppearance() },
    selectionMode: selectionMode(),
    defaultAction: defaultAction(),
    aiDetail: aiDetail(),
    outlineOpen: outlineOpen(),
  })
  const apply = (preferences: ReaderPreferences) => {
    setBookAppearance(preferences.bookAppearance)
    setSelectionMode(preferences.selectionMode)
    setDefaultAction(preferences.defaultAction)
    setAiDetail(preferences.aiDetail)
    setOutlineOpen(preferences.outlineOpen)
  }
  const save = (desired = read(), expectedGeneration = ++generation) => {
    const persist = async () => {
      if (expectedGeneration !== generation) return
      if (JSON.stringify(desired) === JSON.stringify(base)) return
      const original = base
      let next = desired
      try {
        revision = await saveReaderPreferences(next, revision)
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 409) throw reason
        const latest = await loadReaderPreferences()
        next = mergeReaderPreferenceChanges(latest.preferences, original, desired)
        revision = await saveReaderPreferences(next, latest.revision)
      }
      base = next
      if (
        !disposed &&
        expectedGeneration === generation &&
        JSON.stringify(next) !== JSON.stringify(desired)
      ) {
        apply(next)
      }
    }
    const pending = queue.then(persist, persist)
    queue = pending.catch(() => {})
    return pending
  }
  const flush = () => {
    window.clearTimeout(timer)
    return save()
  }

  void loadReaderPreferences()
    .then((envelope) => {
      if (disposed) return
      revision = envelope.revision
      base = envelope.preferences
      apply(envelope.preferences)
      setReady(true)
    })
    .catch(() => {
      if (!disposed) setReady(true)
    })

  createEffect(
    () => (ready() ? read() : null),
    (desired) => {
      if (!desired) return
      const expectedGeneration = ++generation
      window.clearTimeout(timer)
      timer = window.setTimeout(() => untrack(() => void save(desired, expectedGeneration)), 350)
    },
  )

  onCleanup(() => {
    disposed = true
    window.clearTimeout(timer)
    if (ready()) void save()
  })

  const value: ReaderPreferencesContextValue = {
    bookAppearance,
    setBookAppearance,
    selectionMode,
    setSelectionMode,
    defaultAction,
    setDefaultAction,
    aiDetail,
    setAiDetail,
    outlineOpen,
    setOutlineOpen,
    flush,
  }
  return (
    <ReaderPreferencesContext value={value}>
      <Show when={ready()} fallback={<div class='absolute inset-0 bg-neutral-900' />}>
        {props.children}
      </Show>
    </ReaderPreferencesContext>
  )
}

export function useReaderPreferences() {
  return useContext(ReaderPreferencesContext)
}
