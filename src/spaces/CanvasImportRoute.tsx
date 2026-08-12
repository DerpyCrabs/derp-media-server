import {
  inspectCanvasStorage,
  loadCanvasCollection,
  preserveCanvasStorageSources,
  readCanvasStorageSources,
  type CanvasStorageInspection,
} from '@/lib/canvas-persistence'
import { canvasStateToSpace, type Space } from '@/lib/space'
import { createBrowserSpaceTransport } from '@/lib/space-client'
import Download from 'lucide-solid/icons/download'
import { For, Show, createSignal, onMount } from 'solid-js'
import { CanvasPage } from '../CanvasPage'
import { followAppLink, hrefFor } from '../lib/routes'

const CANVAS_IMPORTED_SPACE_KEY = 'space-imported-canvas-id-v1'

export function CanvasImportRoute() {
  const sources = readCanvasStorageSources(localStorage)
  let preservationError: string | null = null
  try {
    preserveCanvasStorageSources(localStorage, sources)
  } catch (cause) {
    preservationError =
      cause instanceof Error ? cause.message : 'Could not preserve original Canvas source'
  }
  const initialInspection = inspectCanvasStorage(localStorage)
  const startLocally = navigator.onLine === false && initialInspection.kind !== 'unexpected'
  const [space, setSpace] = createSignal<Space | null>(null)
  const [localMode, setLocalMode] = createSignal(startLocally)
  const [error, setError] = createSignal<string | null>(preservationError)
  const [needsConfirmation, setNeedsConfirmation] = createSignal(
    initialInspection.kind === 'unexpected' || preservationError !== null,
  )

  function downloadOriginal(source: (typeof sources)[number]) {
    const exactOriginal = localStorage.getItem(source.backupKey) ?? source.raw
    const blob = new Blob([exactOriginal], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download =
      source.key === 'infinite-canvases-v1'
        ? 'canvas-import-source.json'
        : 'canvas-legacy-source.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function sourceCollection(inspection: CanvasStorageInspection, allowRecovery: boolean) {
    if (inspection.kind === 'valid') return inspection.collection
    if (inspection.kind === 'unexpected') return allowRecovery ? inspection.recovery : null
    return loadCanvasCollection(localStorage)
  }

  async function importCanvas(allowRecovery = false) {
    setError(null)
    const inspection = inspectCanvasStorage(localStorage)
    const collection = sourceCollection(inspection, allowRecovery)
    if (!collection) {
      setNeedsConfirmation(true)
      setError(
        inspection.kind === 'unexpected' ? inspection.message : 'Canvas source is unreadable',
      )
      return
    }
    if (navigator.onLine === false) {
      setNeedsConfirmation(false)
      setLocalMode(true)
      return
    }
    try {
      const transport = createBrowserSpaceTransport()
      const allSpaces = await transport.list()
      const existing = allSpaces.filter(
        (item) => item.origin === 'canvas' && item.deletedAt === undefined,
      )
      const importedSpaceId = localStorage.getItem(CANVAS_IMPORTED_SPACE_KEY)
      if (importedSpaceId) {
        try {
          const imported = await transport.load(importedSpaceId)
          if (imported.origin === 'canvas' && imported.deletedAt === undefined) {
            if (inspection.kind === 'valid') {
              const knownIds = new Set(allSpaces.map((item) => item.id))
              const missing = collection.canvases.filter((canvas) => !knownIds.has(canvas.id))
              if (missing.length > 0) await transport.importCanvases(missing)
            }
            setSpace(imported)
            return
          }
        } catch {}
      }
      if (inspection.kind === 'none' && existing.length > 0) {
        setSpace(await transport.load(existing[0]!.id))
        return
      }

      if (inspection.kind !== 'none') {
        const result = await transport.importCanvases(collection.canvases)
        const active = result.spaces.find(
          (item) => item.id === collection.activeId && item.deletedAt === undefined,
        )
        const fallback =
          active ??
          result.spaces.find((item) => item.deletedAt === undefined) ??
          (existing[0] ? await transport.load(existing[0].id) : null)
        if (!fallback) throw new Error('Canvas import produced no usable Space')
        localStorage.setItem(CANVAS_IMPORTED_SPACE_KEY, fallback.id)
        setSpace(fallback)
        return
      }

      const record = collection.canvases.find((canvas) => canvas.id === collection.activeId)
      if (!record?.state) throw new Error('Could not prepare an empty Canvas')
      const draft = canvasStateToSpace({ id: record.id, name: record.name, state: record.state })
      const created = await transport.apply({
        command: {
          type: 'create',
          id: draft.id,
          name: draft.name,
          origin: 'canvas',
          panes: draft.panes,
          arrangements: draft.arrangements,
        },
      })
      localStorage.setItem(CANVAS_IMPORTED_SPACE_KEY, created.id)
      setSpace(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Canvas import failed')
      setLocalMode(true)
    }
  }

  function continueAfterWarning() {
    if (preservationError !== null) return
    setNeedsConfirmation(false)
    if (initialInspection.kind === 'unexpected' && !initialInspection.hasRecoverableCanvas) {
      setLocalMode(true)
      return
    }
    void importCanvas(true)
  }

  onMount(() => {
    if (!startLocally && !needsConfirmation()) void importCanvas()
  })

  return (
    <Show
      when={space()}
      keyed
      fallback={
        <Show
          when={localMode()}
          fallback={
            <main
              class='flex min-h-[70vh] items-center justify-center p-4'
              data-testid='canvas-import-route'
            >
              <div class='bg-card w-full max-w-lg rounded-xl border border-border p-6 shadow-sm'>
                <p class='text-primary text-sm font-semibold'>Canvas to Space</p>
                <h1 class='mt-1 text-xl font-semibold'>
                  {needsConfirmation()
                    ? 'Canvas source needs attention'
                    : 'Preparing durable Canvas…'}
                </h1>
                <p class='text-muted-foreground mt-2 text-sm'>
                  {needsConfirmation()
                    ? 'Original browser data remains unchanged. Export it before choosing whether to continue with recoverable data or a new empty Canvas.'
                    : 'Existing Canvas IDs, panes, and placement stay intact. Camera and selection remain on this device.'}
                </p>
                <Show
                  when={
                    error() ||
                    (initialInspection.kind === 'unexpected' ? initialInspection.message : null)
                  }
                >
                  {(message) => (
                    <div class='border-destructive/40 bg-destructive/5 mt-4 rounded-lg border p-3 text-sm'>
                      <p data-testid='canvas-import-error'>{message()}</p>
                    </div>
                  )}
                </Show>
                <Show when={needsConfirmation()}>
                  <div class='mt-4 flex flex-wrap gap-2'>
                    <Show when={sources.length > 0}>
                      <For each={sources}>
                        {(source, index) => (
                          <button
                            type='button'
                            class='inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 font-medium'
                            onClick={() => downloadOriginal(source)}
                          >
                            <Download class='size-4' />
                            {index() === 0 ? 'Export exact original' : 'Export exact legacy source'}
                          </button>
                        )}
                      </For>
                    </Show>
                    <button
                      type='button'
                      class='bg-primary text-primary-foreground min-h-10 rounded-md px-3 font-medium'
                      data-testid='canvas-import-continue'
                      disabled={preservationError !== null}
                      onClick={continueAfterWarning}
                    >
                      {initialInspection.kind === 'unexpected' &&
                      !initialInspection.hasRecoverableCanvas
                        ? 'Start empty local Canvas'
                        : 'Continue with recoverable Canvas'}
                    </button>
                    <a
                      href={hrefFor({ kind: 'spaces' })}
                      class='inline-flex min-h-10 items-center rounded-md px-3 font-medium'
                      onClick={(event) => followAppLink(event, hrefFor({ kind: 'spaces' }))}
                    >
                      Open Spaces
                    </a>
                  </div>
                </Show>
              </div>
            </main>
          }
        >
          <CanvasPage />
        </Show>
      }
    >
      {(loadedSpace) => <CanvasPage initialSpace={loadedSpace} />}
    </Show>
  )
}
