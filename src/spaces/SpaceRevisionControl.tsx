import type { Space } from '@/lib/space'
import type { OptimisticSpaceClient, SpaceHistoryEntry, SpaceTransport } from '@/lib/space-client'
import Clock3 from 'lucide-solid/icons/clock-3'
import Copy from 'lucide-solid/icons/copy'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import X from 'lucide-solid/icons/x'
import { For, Show, createSignal, onMount, type Accessor } from 'solid-js'

export function SpaceRevisionControl(props: {
  space: Accessor<Space>
  transport: SpaceTransport
  client?: OptimisticSpaceClient
  onBeforeAction?: () => void
  onRestored(space: Space): void
  triggerClass?: string
  compact?: boolean
}) {
  const [open, setOpen] = createSignal(false)
  const [history, setHistory] = createSignal<SpaceHistoryEntry[]>([])
  const [currentRevision, setCurrentRevision] = createSignal(props.space().revision)
  const [error, setError] = createSignal<string | null>(null)
  const [busyRevision, setBusyRevision] = createSignal<number | null>(null)

  async function loadHistory() {
    setError(null)
    try {
      const [entries, latest] = await Promise.all([
        props.transport.history(props.space().id),
        props.transport.load(props.space().id),
      ])
      setHistory(entries)
      setCurrentRevision(latest.revision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revision history failed to load')
    }
  }

  function showHistory() {
    if (window.location.hash !== '#history') {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#history`,
      )
    }
    setOpen(true)
    void loadHistory()
  }

  function closeHistory() {
    setOpen(false)
    if (window.location.hash === '#history') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }

  async function restore(entry: SpaceHistoryEntry) {
    if (!window.confirm(`Restore revision ${entry.revision}? Current state remains in history.`))
      return
    setBusyRevision(entry.revision)
    setError(null)
    try {
      props.onBeforeAction?.()
      await props.client?.waitForIdle()
      if (props.client) {
        const restored = await props.client.dispatch({
          type: 'restoreRevision',
          revision: entry.revision,
        })
        props.onRestored(restored)
        await loadHistory()
        return
      }
      const latest = await props.transport.load(props.space().id)
      const restored = await props.transport.apply({
        spaceId: props.space().id,
        expectedRevision: latest.revision,
        command: { type: 'restoreRevision', revision: entry.revision },
      })
      props.onRestored(restored)
      await loadHistory()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revision could not be restored')
    } finally {
      setBusyRevision(null)
    }
  }

  async function duplicate(entry: SpaceHistoryEntry) {
    setBusyRevision(entry.revision)
    setError(null)
    try {
      props.onBeforeAction?.()
      await props.client?.waitForIdle()
      if (props.client) {
        const duplicate = await props.client.dispatch({
          type: 'duplicate',
          sourceRevision: entry.revision,
          newId: crypto.randomUUID(),
          name: `${entry.name.slice(0, 115).trimEnd()} copy`,
        })
        props.onRestored(duplicate)
        return
      }
      const latest = await props.transport.load(props.space().id)
      const suffix = ' copy'
      const duplicate = await props.transport.apply({
        spaceId: props.space().id,
        expectedRevision: latest.revision,
        command: {
          type: 'duplicate',
          sourceRevision: entry.revision,
          newId: crypto.randomUUID(),
          name: `${entry.name.slice(0, 120 - suffix.length).trimEnd()}${suffix}`,
        },
      })
      props.onRestored(duplicate)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revision could not be duplicated')
    } finally {
      setBusyRevision(null)
    }
  }

  onMount(() => {
    if (window.location.hash === '#history') showHistory()
  })

  return (
    <>
      <button
        type='button'
        data-testid='space-history-trigger'
        class={
          props.triggerClass ??
          'fixed bottom-16 left-3 z-[105000] inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-popover px-3 text-sm font-medium shadow-xl'
        }
        onClick={showHistory}
      >
        <Clock3 class='size-4' />
        <Show when={!props.compact}>History</Show>
      </button>
      <Show when={open()}>
        <div class='fixed inset-0 z-[110000] bg-black/35' onClick={closeHistory} />
        <aside
          role='dialog'
          aria-label='Space revision history'
          class='bg-popover fixed inset-y-0 right-0 z-[110001] flex w-full max-w-md flex-col border-l border-border shadow-2xl'
        >
          <header class='flex h-14 items-center border-b border-border px-4'>
            <div class='min-w-0 flex-1'>
              <h2 class='truncate font-semibold'>Revision history</h2>
              <p class='text-muted-foreground text-xs'>Current revision {currentRevision()}</p>
            </div>
            <button
              type='button'
              class='inline-flex size-10 items-center justify-center rounded-md hover:bg-muted'
              aria-label='Close revision history'
              onClick={closeHistory}
            >
              <X class='size-4' />
            </button>
          </header>
          <div class='min-h-0 flex-1 overflow-auto p-3'>
            <Show when={error()}>
              {(message) => (
                <div class='border-destructive/40 bg-destructive/5 mb-3 rounded-md border p-3 text-sm'>
                  {message()}
                </div>
              )}
            </Show>
            <For each={history()}>
              {(entry) => (
                <article class='mb-2 rounded-lg border border-border p-3'>
                  <div class='flex items-start gap-2'>
                    <div class='min-w-0 flex-1'>
                      <p class='font-medium'>Revision {entry.revision}</p>
                      <p class='text-muted-foreground mt-0.5 truncate text-xs'>
                        {entry.name} · {entry.commandType} ·{' '}
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Show when={entry.revision !== currentRevision()}>
                      <button
                        type='button'
                        class='inline-flex size-10 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50'
                        aria-label={`Restore revision ${entry.revision}`}
                        disabled={busyRevision() !== null}
                        onClick={() => void restore(entry)}
                      >
                        <RotateCcw class='size-4' />
                      </button>
                    </Show>
                    <button
                      type='button'
                      class='inline-flex size-10 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50'
                      aria-label={`Duplicate revision ${entry.revision}`}
                      disabled={busyRevision() !== null}
                      onClick={() => void duplicate(entry)}
                    >
                      <Copy class='size-4' />
                    </button>
                  </div>
                </article>
              )}
            </For>
            <Show when={!error() && history().length === 0}>
              <p class='text-muted-foreground p-4 text-center text-sm'>No retained revisions.</p>
            </Show>
          </div>
        </aside>
      </Show>
    </>
  )
}
