import { viewWindow } from '@/lib/browser/view-window'
import type { DomLifetime } from 'effectweb'
import { scrollAffectsElement } from '@/lib/ui/scroll-affects-element'
import type { FileItem } from '@/lib/files/types'
import { registerVirtualFileScroller } from './virtual-directory-scroll'
import { mountThumbnailWarmup } from './thumbnail-warmup'
export type DirectoryRange = { start: number; end: number; columns: number; rowHeight: number }
export type DirectoryViewport = {
  files: readonly FileItem[]
  warmThumbnails?: boolean
  includeParent: boolean
  target: { kind: 'window' } | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }
  scope?: string
  grid: boolean
  estimateSize?: number
  overscan?: number
  range: DirectoryRange
  focusOnLoad?: boolean
  onFocused?: () => void
  onMoveFocus?: (from: FileItem, to: FileItem, event: KeyboardEvent) => void
  patch: (range: DirectoryRange) => void
}
export const directoryViewport = (
  element: HTMLDivElement,
  current: () => DirectoryViewport,
  lifetime: DomLifetime,
) => {
  const document = element.ownerDocument
  const window = viewWindow({ document })
  let unregister: (() => void) | undefined
  let registeredScope: string | undefined
  const read = () => {
    const state = current()
    const width = element.clientWidth
    const columns = state.grid ? Math.max(1, Math.min(6, Math.floor((width + 16) / 144))) : 1
    const rowHeight = state.grid
      ? Math.ceil((((width - (columns - 1) * 16) / columns) * 9) / 16 + 64) + 16
      : (state.estimateSize ?? (window.matchMedia('(min-width:640px)').matches ? 37 : 53))
    const scroll = state.target.kind === 'element' ? state.target.getScrollElement() : null
    const top = scroll
      ? element.getBoundingClientRect().top - scroll.getBoundingClientRect().top
      : element.getBoundingClientRect().top
    const height = scroll?.clientHeight ?? window.innerHeight
    const count = Math.ceil((state.files.length + (state.includeParent ? 1 : 0)) / columns)
    const overscan = state.overscan ?? (state.grid ? 4 : 12)
    const virtual = state.files.length > 100
    const start = virtual
      ? Math.max(0, Math.min(count, Math.floor(-top / rowHeight) - overscan))
      : 0
    const end = virtual
      ? Math.min(count, Math.max(start, Math.ceil((height - top) / rowHeight) + overscan))
      : count
    return { start, end, columns, rowHeight }
  }
  const write = ({ start, end, columns, rowHeight }: DirectoryRange) => {
    const state = current()
    if (
      start !== state.range.start ||
      end !== state.range.end ||
      columns !== state.range.columns ||
      rowHeight !== state.range.rowHeight
    )
      state.patch({ start, end, columns, rowHeight })
    if (registeredScope !== state.scope) {
      unregister?.()
      registeredScope = state.scope
      unregister = state.scope
        ? registerVirtualFileScroller(state.scope, {
            hasPath: (path) => current().files.some((file) => file.path === path),
            scrollToPath: (path) => {
              const value = current()
              const index = value.files.findIndex((file) => file.path === path)
              if (index < 0) return
              const offset =
                Math.floor((index + (value.includeParent ? 1 : 0)) / value.range.columns) *
                value.range.rowHeight
              const target =
                value.target.kind === 'element' ? value.target.getScrollElement() : window
              const rect = element.getBoundingClientRect()
              const base =
                target instanceof window.HTMLElement
                  ? rect.top - target.getBoundingClientRect().top + target.scrollTop
                  : rect.top + window.scrollY
              target?.scrollTo({
                top: Math.max(
                  0,
                  base +
                    offset -
                    (target instanceof window.HTMLElement
                      ? target.clientHeight
                      : window.innerHeight) /
                      2,
                ),
                behavior: 'smooth',
              })
            },
          })
        : undefined
    }
  }
  const measurement = lifetime.measure({ read, write })
  const schedule = measurement.schedule
  const onScroll = (event: Event) => {
    if (scrollAffectsElement(event, element)) schedule()
  }
  let focusFrame = 0
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.shiftKey && !current().onMoveFocus)
    )
      return
    if (
      !(event.target instanceof window.HTMLElement) ||
      event.target.closest('input, textarea, button, a, [contenteditable=true]')
    )
      return
    const row = event.target.closest<HTMLElement>('[data-file-path]')
    if (!row || !element.contains(row)) return
    const state = current()
    const index = state.files.findIndex((file) => file.path === row.dataset.filePath)
    if (index < 0) return
    const delta =
      event.key === 'ArrowDown'
        ? state.grid
          ? state.range.columns
          : 1
        : event.key === 'ArrowUp'
          ? -(state.grid ? state.range.columns : 1)
          : state.grid && event.key === 'ArrowRight'
            ? 1
            : state.grid && event.key === 'ArrowLeft'
              ? -1
              : 0
    if (!delta && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? state.files.length - 1
          : Math.max(0, Math.min(state.files.length - 1, index + delta))
    const path = state.files[next]?.path
    if (path === undefined) return
    state.onMoveFocus?.(state.files[index]!, state.files[next]!, event)
    const focus = () => {
      const target = element.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(path)}"]`)
      if (!target) return false
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return true
    }
    window.cancelAnimationFrame(focusFrame)
    if (focus()) return
    const target = state.target.kind === 'element' ? state.target.getScrollElement() : window
    const rect = element.getBoundingClientRect()
    const base =
      target instanceof window.HTMLElement
        ? rect.top - target.getBoundingClientRect().top + target.scrollTop
        : rect.top + window.scrollY
    target?.scrollTo({
      top: Math.max(
        0,
        base +
          Math.floor((next + (state.includeParent ? 1 : 0)) / state.range.columns) *
            state.range.rowHeight,
      ),
      behavior: 'instant',
    })
    schedule()
    let attempts = 0
    const retry = () => {
      if (!focus() && ++attempts < 20) focusFrame = window.requestAnimationFrame(retry)
    }
    focusFrame = window.requestAnimationFrame(retry)
  }
  let focusHandled = false
  const focusOnLoad = () => {
    if (focusHandled || !current().focusOnLoad) return
    focusHandled = true
    focusFrame = window.requestAnimationFrame(() => {
      if (
        document.activeElement === document.body ||
        document.activeElement === element.closest('[data-folder-navigation]')
      ) {
        const row = element.querySelector<HTMLElement>('[data-file-path]')
        if (row) row.focus({ preventScroll: true })
        else {
          element.tabIndex = -1
          element.focus({ preventScroll: true })
        }
      }
      current().onFocused?.()
    })
  }
  element.addEventListener('keydown', onKeyDown)
  const observer = new window.ResizeObserver(schedule)
  observer.observe(element)
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('resize', schedule)
  const warmup = mountThumbnailWarmup(element, () =>
    current().warmThumbnails === false ? [] : current().files,
  )
  schedule()
  focusOnLoad()
  return {
    update: () => {
      schedule()
      focusOnLoad()
    },
    dispose: () => {
      window.cancelAnimationFrame(focusFrame)
      element.removeEventListener('keydown', onKeyDown)
      observer.disconnect()
      unregister?.()
      warmup()
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
    },
  }
}
