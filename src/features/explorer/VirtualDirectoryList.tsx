import type { FileItem } from '@/lib/files/types'
import { createVirtualizer, createWindowVirtualizer, type VirtualItem } from '@/lib/virtualizer'
import type { Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js'
import { registerVirtualFileScroller } from './virtual-directory-scroll'

const VIRTUALIZE_THRESHOLD = 100

type ScrollTarget =
  | { kind: 'window' }
  | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }

type VirtualDirectoryListProps = {
  files: Accessor<FileItem[]>
  includeParent: Accessor<boolean>
  scrollTarget: ScrollTarget
  colSpan: number | Accessor<number>
  columns?: Accessor<{ class?: string }[]>
  tableClass?: string | Accessor<string>
  estimateSize?: number
  overscan?: number
  scrollScope?: Accessor<string | undefined>
  sizeColumnClass?: string
  renderParentRow: () => JSX.Element
  renderFileRow: (file: FileItem) => JSX.Element
  renderEmptyRow?: () => JSX.Element
  class?: string
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
  props: VirtualDirectoryListProps,
  accessors: { count: Accessor<number>; scrollMargin: Accessor<number> },
) {
  const getItemKey = (index: number) => {
    const parentCount = props.includeParent() ? 1 : 0
    if (parentCount && index === 0) return '__parent__'
    return props.files()[index - parentCount]?.path ?? index
  }

  if (props.scrollTarget.kind === 'element') {
    const getScrollElement = props.scrollTarget.getScrollElement
    return createVirtualizer<HTMLElement, HTMLTableRowElement>({
      get count() {
        return accessors.count()
      },
      getScrollElement: () => getScrollElement() ?? null,
      get estimateSize() {
        const size = props.estimateSize ?? 48
        return () => size
      },
      getItemKey,
      overscan: props.overscan ?? 12,
    })
  }

  return createWindowVirtualizer<HTMLTableRowElement>({
    get count() {
      return accessors.count()
    },
    get estimateSize() {
      const size = props.estimateSize ?? 48
      return () => size
    },
    getItemKey,
    overscan: props.overscan ?? 12,
    get scrollMargin() {
      return accessors.scrollMargin()
    },
  })
}

function VirtualDirectoryListItem(props: {
  item: VirtualItem
  files: Accessor<FileItem[]>
  parentCount: Accessor<number>
  renderParentRow: () => JSX.Element
  renderFileRow: (file: FileItem) => JSX.Element
}) {
  const isParent = () => props.parentCount() > 0 && props.item.index === 0
  const file = () => props.files()[props.item.index - props.parentCount()]

  return (
    <Show when={!isParent()} fallback={props.renderParentRow()}>
      <Show keyed when={file()}>
        {(rowFile) => props.renderFileRow(rowFile)}
      </Show>
    </Show>
  )
}

export function VirtualDirectoryList(props: VirtualDirectoryListProps) {
  let containerEl: HTMLDivElement | undefined
  const [scrollMargin, setScrollMargin] = createSignal(0)
  const count = () => props.files().length + (props.includeParent() ? 1 : 0)
  const colSpan = () => (typeof props.colSpan === 'function' ? props.colSpan() : props.colSpan)
  const tableClass = () =>
    typeof props.tableClass === 'function' ? props.tableClass() : props.tableClass
  const virtualizer = makeVirtualizer(props, { count, scrollMargin })

  createEffect(
    () => {
      const itemCount = count()
      const scrollElement =
        props.scrollTarget.kind === 'element'
          ? props.scrollTarget.getScrollElement()
          : document.documentElement
      return itemCount && scrollElement ? { itemCount, scrollElement } : null
    },
    (state) => {
      if (!state) return undefined

      let cancelled = false
      const measure = () => {
        if (cancelled) return
        virtualizer._willUpdate()
        virtualizer.measure()
      }
      queueMicrotask(measure)
      const frame = window.requestAnimationFrame(measure)
      // eslint-disable-next-line solid/reactivity
      return () => {
        cancelled = true
        window.cancelAnimationFrame(frame)
      }
    },
  )

  function updateScrollMargin() {
    if (props.scrollTarget.kind !== 'window' || !containerEl) {
      setScrollMargin(0)
      return
    }
    setScrollMargin(containerEl.getBoundingClientRect().top + window.scrollY)
  }

  function topPadding() {
    const first = virtualizer.getVirtualItems()[0]
    if (!first) return 0
    return Math.max(0, first.start - scrollMargin())
  }

  function bottomPadding() {
    const items = virtualizer.getVirtualItems()
    const last = items[items.length - 1]
    if (!last) return 0
    return Math.max(0, virtualizer.getTotalSize() - last.end)
  }

  createEffect(
    () => {
      const scope = props.scrollScope?.()
      return scope
        ? { scope, files: props.files(), parentCount: props.includeParent() ? 1 : 0 }
        : null
    },
    (state) => {
      if (!state) return undefined

      const unregister = registerVirtualFileScroller(state.scope, {
        hasPath: (path) => state.files.some((file) => file.path === path),
        scrollToPath: (path) => {
          const index = state.files.findIndex((file) => file.path === path)
          if (index === -1) return
          virtualizer.scrollToIndex(index + state.parentCount, { align: 'center' })
          fineTunePathIntoView(path)
        },
      })

      // eslint-disable-next-line solid/reactivity
      return unregister
    },
  )

  onSettled(() => {
    updateScrollMargin()
    if (props.scrollTarget.kind !== 'window') return undefined

    window.addEventListener('resize', updateScrollMargin)
    window.addEventListener('scroll', updateScrollMargin, { passive: true })
    // eslint-disable-next-line solid/reactivity
    return () => {
      window.removeEventListener('resize', updateScrollMargin)
      window.removeEventListener('scroll', updateScrollMargin)
    }
  })

  const table = (children: JSX.Element) => (
    <div
      ref={(el) => {
        containerEl = el
        updateScrollMargin()
      }}
      class={props.class}
    >
      <table class={`w-full table-fixed caption-bottom text-sm ${tableClass() ?? ''}`}>
        <colgroup>
          <Show
            when={props.columns}
            fallback={
              <>
                <col class='w-[40px]' />
                <col />
                <col class={props.sizeColumnClass ?? 'w-24'} />
                <Show when={colSpan() >= 4}>
                  <col class='w-[52px]' />
                </Show>
              </>
            }
          >
            <For each={props.columns?.() ?? []}>{(column) => <col class={column.class} />}</For>
          </Show>
        </colgroup>
        <tbody class='[&_tr:last-child]:border-0'>{children}</tbody>
      </table>
    </div>
  )

  const unvirtualizedRows = () => (
    <>
      <Show when={props.includeParent()}>{props.renderParentRow()}</Show>
      <For each={props.files()}>{(file) => props.renderFileRow(file)}</For>
      {props.renderEmptyRow?.()}
    </>
  )

  return (
    <Show when={count() > VIRTUALIZE_THRESHOLD} fallback={table(unvirtualizedRows())}>
      {table(
        <Show when={virtualizer.getVirtualItems().length > 0} fallback={unvirtualizedRows()}>
          <>
            <Show when={topPadding() > 0}>
              <tr aria-hidden='true'>
                <td colspan={colSpan()} style={{ height: `${topPadding()}px`, padding: '0' }} />
              </tr>
            </Show>
            <For each={virtualizer.getVirtualItems()}>
              {(item) => (
                <VirtualDirectoryListItem
                  item={item}
                  files={props.files}
                  parentCount={() => (props.includeParent() ? 1 : 0)}
                  renderParentRow={props.renderParentRow}
                  renderFileRow={props.renderFileRow}
                />
              )}
            </For>
            {props.renderEmptyRow?.()}
            <Show when={bottomPadding() > 0}>
              <tr aria-hidden='true'>
                <td colspan={colSpan()} style={{ height: `${bottomPadding()}px`, padding: '0' }} />
              </tr>
            </Show>
          </>
        </Show>,
      )}
    </Show>
  )
}
