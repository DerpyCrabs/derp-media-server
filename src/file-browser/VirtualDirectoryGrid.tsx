import type { FileItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  createVirtualizer,
  createWindowVirtualizer,
  type VirtualItem,
} from '@tanstack/solid-virtual'
import type { Accessor, JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { registerVirtualFileScroller } from './virtual-directory-scroll'

type ScrollTarget =
  | { kind: 'window' }
  | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }

type VirtualDirectoryGridProps = {
  files: Accessor<FileItem[]>
  includeParent: Accessor<boolean>
  scrollTarget: ScrollTarget
  scrollScope?: Accessor<string | undefined>
  class?: string
  renderParentCard: () => JSX.Element
  renderFileCard: (file: FileItem) => JSX.Element
}

const VIRTUALIZE_THRESHOLD = 100
const GRID_GAP_PX = 16
const MIN_CARD_WIDTH_PX = 128
const MAX_GRID_COLUMNS = 6

function calculateColumns(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 1
  return Math.max(
    1,
    Math.min(
      MAX_GRID_COLUMNS,
      Math.floor((width + GRID_GAP_PX) / (MIN_CARD_WIDTH_PX + GRID_GAP_PX)),
    ),
  )
}

function fineTunePathIntoView(path: string) {
  window.setTimeout(() => {
    if (!path || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') return
    document
      .querySelector<HTMLElement>(`[data-file-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }, 0)
}

function makeVirtualizer(
  props: VirtualDirectoryGridProps,
  rowCount: Accessor<number>,
  rowHeight: Accessor<number>,
  scrollMargin: Accessor<number>,
) {
  if (props.scrollTarget.kind === 'element') {
    const getScrollElement = props.scrollTarget.getScrollElement
    return createVirtualizer<HTMLElement, HTMLDivElement>({
      get count() {
        return rowCount()
      },
      getScrollElement: () => getScrollElement() ?? null,
      estimateSize: () => rowHeight(),
      overscan: 4,
    })
  }

  return createWindowVirtualizer<HTMLDivElement>({
    get count() {
      return rowCount()
    },
    estimateSize: () => rowHeight(),
    overscan: 4,
    get scrollMargin() {
      return scrollMargin()
    },
  })
}

function VirtualDirectoryGridItem(props: {
  absoluteIndex: number
  files: Accessor<FileItem[]>
  parentCount: Accessor<number>
  renderParentCard: () => JSX.Element
  renderFileCard: (file: FileItem) => JSX.Element
}) {
  const isParent = () => props.parentCount() > 0 && props.absoluteIndex === 0
  const file = () => props.files()[props.absoluteIndex - props.parentCount()]

  return (
    <Show when={!isParent()} fallback={props.renderParentCard()}>
      <Show keyed when={file()}>
        {(cardFile) => props.renderFileCard(cardFile)}
      </Show>
    </Show>
  )
}

export function VirtualDirectoryGrid(props: VirtualDirectoryGridProps) {
  let containerEl: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  const [containerWidth, setContainerWidth] = createSignal(0)
  const [scrollMargin, setScrollMargin] = createSignal(0)
  const totalItems = () => props.files().length + (props.includeParent() ? 1 : 0)
  const columns = createMemo(() => calculateColumns(containerWidth()))
  const rowCount = createMemo(() => Math.ceil(totalItems() / columns()))
  const rowHeight = createMemo(() => {
    const width = containerWidth()
    const cols = columns()
    const cardWidth =
      width > 0 ? (width - GRID_GAP_PX * Math.max(0, cols - 1)) / cols : MIN_CARD_WIDTH_PX
    return Math.ceil(cardWidth * (9 / 16) + 76 + GRID_GAP_PX)
  })
  const virtualizer = makeVirtualizer(props, rowCount, rowHeight, scrollMargin)

  function updateMeasurements() {
    if (containerEl) {
      setContainerWidth(containerEl.getBoundingClientRect().width)
    }

    if (props.scrollTarget.kind === 'window' && containerEl) {
      setScrollMargin(containerEl.getBoundingClientRect().top + window.scrollY)
    } else {
      setScrollMargin(0)
    }
  }

  function rowOffset(item: VirtualItem) {
    return Math.max(0, item.start - scrollMargin())
  }

  createEffect(() => {
    const scope = props.scrollScope?.()
    const files = props.files()
    const parentCount = props.includeParent() ? 1 : 0
    const cols = columns()
    if (!scope) return

    const unregister = registerVirtualFileScroller(scope, {
      hasPath: (path) => files.some((file) => file.path === path),
      scrollToPath: (path) => {
        const index = files.findIndex((file) => file.path === path)
        if (index === -1) return
        virtualizer.scrollToIndex(Math.floor((index + parentCount) / cols), { align: 'center' })
        fineTunePathIntoView(path)
      },
    })

    onCleanup(unregister)
  })

  onMount(() => {
    updateMeasurements()
    if (containerEl) {
      resizeObserver = new ResizeObserver(updateMeasurements)
      resizeObserver.observe(containerEl)
    }
    window.addEventListener('resize', updateMeasurements)
    if (props.scrollTarget.kind === 'window') {
      window.addEventListener('scroll', updateMeasurements, { passive: true })
    }
    onCleanup(() => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMeasurements)
      window.removeEventListener('scroll', updateMeasurements)
    })
  })

  return (
    <Show
      when={totalItems() > VIRTUALIZE_THRESHOLD}
      fallback={
        <div class={cn('file-browser-grid', props.class)}>
          <Show when={props.includeParent()}>{props.renderParentCard()}</Show>
          <For each={props.files()}>{(file) => props.renderFileCard(file)}</For>
        </div>
      }
    >
      <div
        ref={(el) => {
          containerEl = el
          updateMeasurements()
        }}
        class={cn('file-browser-grid', props.class)}
        style={{
          display: 'block',
          position: 'relative',
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(row) => (
            <div
              style={{
                position: 'absolute',
                left: '0',
                top: '0',
                width: '100%',
                transform: `translateY(${rowOffset(row)}px)`,
                display: 'grid',
                'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
                gap: `${GRID_GAP_PX}px`,
              }}
            >
              <For
                each={Array.from(
                  { length: columns() },
                  (_, index) => row.index * columns() + index,
                )}
              >
                {(absoluteIndex) => (
                  <VirtualDirectoryGridItem
                    absoluteIndex={absoluteIndex}
                    files={props.files}
                    parentCount={() => (props.includeParent() ? 1 : 0)}
                    renderParentCard={props.renderParentCard}
                    renderFileCard={props.renderFileCard}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
