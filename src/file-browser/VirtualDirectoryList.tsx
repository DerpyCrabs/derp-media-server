import type { FileItem } from '@/lib/types'
import {
  createVirtualizer,
  createWindowVirtualizer,
  type VirtualItem,
} from '@tanstack/solid-virtual'
import type { Accessor, JSX } from 'solid-js'
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { registerVirtualFileScroller } from './virtual-directory-scroll'

const VIRTUALIZE_THRESHOLD = 100

type ScrollTarget =
  | { kind: 'window' }
  | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }

type VirtualDirectoryListProps = {
  files: Accessor<FileItem[]>
  includeParent: Accessor<boolean>
  scrollTarget: ScrollTarget
  colSpan: number
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
  count: Accessor<number>,
  scrollMargin: Accessor<number>,
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
        return count()
      },
      getScrollElement: () => getScrollElement() ?? null,
      estimateSize: () => props.estimateSize ?? 48,
      getItemKey,
      overscan: props.overscan ?? 12,
    })
  }

  return createWindowVirtualizer<HTMLTableRowElement>({
    get count() {
      return count()
    },
    estimateSize: () => props.estimateSize ?? 48,
    getItemKey,
    overscan: props.overscan ?? 12,
    get scrollMargin() {
      return scrollMargin()
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
  const virtualizer = makeVirtualizer(props, count, scrollMargin)

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

  createEffect(() => {
    const scope = props.scrollScope?.()
    const files = props.files()
    const parentCount = props.includeParent() ? 1 : 0
    if (!scope) return

    const unregister = registerVirtualFileScroller(scope, {
      hasPath: (path) => files.some((file) => file.path === path),
      scrollToPath: (path) => {
        const index = files.findIndex((file) => file.path === path)
        if (index === -1) return
        virtualizer.scrollToIndex(index + parentCount, { align: 'center' })
        fineTunePathIntoView(path)
      },
    })

    onCleanup(unregister)
  })

  onMount(() => {
    updateScrollMargin()
    if (props.scrollTarget.kind !== 'window') return

    window.addEventListener('resize', updateScrollMargin)
    window.addEventListener('scroll', updateScrollMargin, { passive: true })
    onCleanup(() => {
      window.removeEventListener('resize', updateScrollMargin)
      window.removeEventListener('scroll', updateScrollMargin)
    })
  })

  const table = (children: JSX.Element) => (
    <div
      ref={(el) => {
        containerEl = el
        updateScrollMargin()
      }}
      class={props.class}
    >
      <table class='w-full table-fixed caption-bottom text-sm'>
        <colgroup>
          <col class='w-[40px]' />
          <col />
          <col class={props.sizeColumnClass ?? 'w-24'} />
          <col class='w-[52px]' />
        </colgroup>
        <tbody class='[&_tr:last-child]:border-0'>{children}</tbody>
      </table>
    </div>
  )

  return (
    <Show
      when={count() > VIRTUALIZE_THRESHOLD}
      fallback={table(
        <>
          <Show when={props.includeParent()}>{props.renderParentRow()}</Show>
          <For each={props.files()}>{(file) => props.renderFileRow(file)}</For>
          {props.renderEmptyRow?.()}
        </>,
      )}
    >
      {table(
        <>
          <Show when={topPadding() > 0}>
            <tr aria-hidden='true'>
              <td colSpan={props.colSpan} style={{ height: `${topPadding()}px`, padding: '0' }} />
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
              <td
                colSpan={props.colSpan}
                style={{ height: `${bottomPadding()}px`, padding: '0' }}
              />
            </tr>
          </Show>
        </>,
      )}
    </Show>
  )
}
