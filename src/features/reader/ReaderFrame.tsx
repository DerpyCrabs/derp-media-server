import { showAppAlertEffect } from '@/lib/ui/app-dialog'
import { cn } from '@/lib/ui/cn'
import { Effect } from 'effect'
import {
  commandSlot,
  domBinding,
  modelOwner,
  Portal,
  view,
  type JSX,
  type Snapshot,
  controllerView,
  type ControllerModel,
} from 'effectweb'
import Maximize2 from '@effectweb/lucide/icons/maximize-2'
import Minimize2 from '@effectweb/lucide/icons/minimize-2'
import PanelLeft from '@effectweb/lucide/icons/panel-left'
import Settings from '@effectweb/lucide/icons/settings'
import X from '@effectweb/lucide/icons/x'
import { registerDesktopCloseHandler } from '@/desktop/close-handlers'
import { menuPositionForRect, visibleRectForRange } from './reader-geometry'
import { closeReader } from './reader-url'
import { ReaderSelectionMenu, type ReaderSelection } from './ReaderSelectionMenu'
import { ReaderSetting, Segmented } from './ReaderSettings'
import { readerPreferences } from './ReaderPreferences'
import type { ReaderDefaultAction, ReaderSelectionMode } from './reader-position'
import type { ReaderPresentation } from './reader-types'
let activeReaderRoot: HTMLElement | null = null
export type ReaderFrameContent = {
  viewport: () => HTMLDivElement | undefined
  selectionMode: ReaderSelectionMode
  selectRegion: (selection: Omit<ReaderSelection, 'id'>) => void
  clearSelection: () => void
}
type Props = ReaderPresentation & {
  title: string
  sourcePath: string
  selectionModes: readonly ReaderSelectionMode[]
  toolbar: JSX.Element
  settings?: (close: () => void) => JSX.Element
  settingsWide?: boolean
  outline?: JSX.Element
  content: (frame: ReaderFrameContent) => JSX.Element
  onViewport?: (viewport: HTMLDivElement) => void
  onScroll?: (viewport: HTMLDivElement) => void
  onKeyDown?: (event: KeyboardEvent, viewport: HTMLDivElement) => boolean
  onEscape?: () => boolean
  beforeClose?: () => Effect.Effect<void, unknown>
}
const closeSlot = commandSlot('reader-close')
function frameController(props: Snapshot<Props>) {
  let viewport: HTMLDivElement | undefined
  let root: HTMLDivElement | undefined
  let selectionId = 0
  const menuHost = document.createElement('div')
  const owner = modelOwner({
    props,
    menuHost,
    preferences: readerPreferences.read(),
    settingsOpen: false,
    fullscreen: false,
    selection: null as ReaderSelection | null,
  })
  const actions = {
    settings: (open: boolean) => owner.patch({ settingsOpen: open }),
    clearSelection: () => {
      owner.patch({ selection: null })
      window.getSelection()?.removeAllRanges()
    },
    selectRegion: (next: Omit<ReaderSelection, 'id'>) =>
      owner.patch({ selection: { ...next, id: ++selectionId } }),
    selectionText: (text: string) => {
      const selection = owner.read().selection
      if (selection) owner.patch({ selection: { ...selection, text } })
    },
    viewport: (element: HTMLDivElement) => {
      viewport = element
      owner.read().props.onViewport?.(element)
    },
    getViewport: () => viewport,
    scroll: () => syncSelectionMenu(),
    root: (element: HTMLDivElement) => {
      root = element
      if (!activeReaderRoot || !owner.read().props.embedded) activeReaderRoot = element
    },
    activate: () => {
      if (root) activeReaderRoot = root
    },
    fullscreen: () =>
      Effect.tryPromise(async () => {
        if (!root) return
        if (document.fullscreenElement === root) await document.exitFullscreen()
        else {
          if (document.fullscreenElement) await document.exitFullscreen()
          await root.requestFullscreen()
        }
      }),
    close: () =>
      owner.run(
        closeSlot,
        Effect.gen(function* () {
          yield* owner.read().props.beforeClose?.() ?? Effect.void
          yield* readerPreferences.flush()
          const onClose = owner.read().props.onClose
          if (onClose) onClose()
          else closeReader()
        }).pipe(
          Effect.catch((error) =>
            showAppAlertEffect(
              error instanceof Error ? error.message : String(error),
              'Could not save reading progress',
            ),
          ),
        ),
        'drop',
      ),
    attach: (element: HTMLDivElement) => attach(element),
  }
  const mode = () => {
    const state = owner.read()
    return state.props.selectionModes.includes(state.preferences.selectionMode)
      ? state.preferences.selectionMode
      : (state.props.selectionModes[0] ?? 'text')
  }
  const captureText = (pointer: { x: number; y: number }) => {
    if (mode() !== 'text' || !viewport) return
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed || !selected.rangeCount) return
    const range = selected.getRangeAt(0)
    const node = range.commonAncestorContainer
    const element = node instanceof Element ? node : node.parentElement
    const text = selected.toString().replace(/\s+/g, ' ').trim()
    if (!element || !viewport.contains(element) || !text) return
    const rect = visibleRectForRange(
      range,
      selected.focusNode,
      selected.focusOffset,
      pointer,
      viewport,
    )
    if (rect)
      owner.patch({
        selection: {
          id: ++selectionId,
          kind: 'text',
          text,
          ...menuPositionForRect(rect, viewport),
        },
      })
  }
  const syncSelectionMenu = () => {
    const active = owner.read().selection
    if (!viewport || !active) return
    if (active.kind === 'image' && active.anchor?.isConnected && active.region) {
      const source = active.anchor.querySelector<HTMLCanvasElement | HTMLImageElement>(
        'canvas, img',
      )
      const bounds = active.anchor.getBoundingClientRect()
      const width = source instanceof HTMLImageElement ? source.naturalWidth : source?.width
      const height = source instanceof HTMLImageElement ? source.naturalHeight : source?.height
      if (width && height)
        owner.patch({
          selection: {
            ...active,
            ...menuPositionForRect(
              new DOMRect(
                bounds.left + (active.region.x / width) * bounds.width,
                bounds.top + (active.region.y / height) * bounds.height,
                (active.region.width / width) * bounds.width,
                (active.region.height / height) * bounds.height,
              ),
              viewport,
            ),
          },
        })
      return
    }
    const selected = window.getSelection()
    if (active.kind !== 'text' || !selected || !selected.rangeCount || selected.isCollapsed) return
    const rect = visibleRectForRange(
      selected.getRangeAt(0),
      selected.focusNode,
      selected.focusOffset,
      null,
      viewport,
    )
    if (rect) owner.patch({ selection: { ...active, ...menuPositionForRect(rect, viewport) } })
  }
  const attach = (element: HTMLDivElement) => {
    actions.root(element)
    document.body.append(menuHost)
    const stopClose = registerDesktopCloseHandler(() =>
      Effect.gen(function* () {
        yield* owner.read().props.beforeClose?.() ?? Effect.void
        yield* readerPreferences.flush()
      }),
    )
    let frame = 0
    const released = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-testid="reader-selection-menu"]')
      )
        return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => captureText({ x: event.clientX, y: event.clientY }))
    }
    const fullscreen = () => {
      const active = document.fullscreenElement === element
      owner.patch({ fullscreen: active })
      if (active) element.append(menuHost)
      else document.body.append(menuHost)
    }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const targetReader = target?.closest('[data-testid="reader-dialog"]')
      if (
        targetReader
          ? targetReader !== element
          : document.fullscreenElement !== element && activeReaderRoot !== element
      )
        return
      const current = owner.read()
      if (event.key === 'Escape') {
        if (current.props.onEscape?.()) return
        if (current.settingsOpen) owner.patch({ settingsOpen: false })
        else if (current.selection) actions.clearSelection()
        else if (!current.props.embedded || current.props.onClose) actions.close()
        return
      }
      if (
        target?.closest(
          'input, textarea, button, [contenteditable=true], [data-testid="reader-selection-menu"]',
        ) ||
        !viewport
      )
        return
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        viewport.scrollBy({ top: event.key === 'ArrowDown' ? 40 : -40 })
        return
      }
      current.props.onKeyDown?.(event, viewport)
    }
    document.addEventListener('fullscreenchange', fullscreen)
    document.addEventListener('pointerup', released)
    document.addEventListener('mouseup', released)
    document.addEventListener('keydown', keydown)
    return () => {
      stopClose?.()
      cancelAnimationFrame(frame)
      document.removeEventListener('fullscreenchange', fullscreen)
      document.removeEventListener('pointerup', released)
      document.removeEventListener('mouseup', released)
      document.removeEventListener('keydown', keydown)
      if (activeReaderRoot === element) activeReaderRoot = null
    }
  }
  owner.own(
    readerPreferences.source.subscribe((state) => owner.patch({ preferences: state.preferences })),
  )
  return {
    source: owner.source,
    actions,
    receive: (next: Snapshot<Props>) => owner.patch({ props: next }),
    dispose: () => {
      menuHost.remove()
      owner.dispose()
    },
  }
}
const rootBinding = (
  element: HTMLDivElement,
  current: () => ControllerModel<typeof frameController>['actions'],
) => current().attach(element)
const viewportBinding = (
  element: HTMLDivElement,
  current: () => (viewport: HTMLDivElement) => void,
) => {
  current()(element)
  return { update: () => current()(element), dispose: () => {} }
}
const buttonClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
export const ReaderFrame = controllerView({
  create: frameController,
  view: view((model) => {
    const props = model.props,
      actions = model.actions,
      preferences = model.preferences
    const mode = props.selectionModes.includes(preferences.selectionMode)
      ? preferences.selectionMode
      : (props.selectionModes[0] ?? 'text')
    const frame: ReaderFrameContent = {
      viewport: actions.getViewport,
      selectionMode: mode,
      selectRegion: actions.selectRegion,
      clearSelection: actions.clearSelection,
    }
    return (
      <div
        use={domBinding(actions, rootBinding)}
        role={props.embedded ? 'region' : 'dialog'}
        aria-modal={props.embedded ? undefined : 'true'}
        aria-label={`Reader: ${props.title}`}
        class={cn('inset-0 flex flex-col bg-neutral-900 text-white', {
          'fixed z-[70]': !props.embedded,
          'absolute z-20': props.embedded,
        })}
        data-testid='reader-dialog'
        onPointerDown={actions.activate}
        onFocusIn={actions.activate}
      >
        <header class='relative z-30 grid h-[39px] shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1.5 border-b border-[#303030] bg-[#121212] px-1.5 py-[3px]'>
          {props.outline ? (
            <button
              type='button'
              aria-label='Toggle document outline'
              data-testid='reader-outline-button'
              class={`${buttonClass} col-start-1 row-start-1`}
              onClick={() => readerPreferences.patch({ outlineOpen: !preferences.outlineOpen })}
            >
              <PanelLeft size={18} />
            </button>
          ) : null}
          <div class='col-start-2 row-start-1 flex min-w-0 items-center justify-center gap-1'>
            <button
              type='button'
              aria-label={model.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={model.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              class={buttonClass}
              onClick={actions.fullscreen}
            >
              {model.fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            {props.toolbar}
            <div class='relative shrink-0'>
              <button
                type='button'
                aria-label='Reader settings'
                data-testid='reader-settings-button'
                class={buttonClass}
                onClick={() => actions.settings(!model.settingsOpen)}
              >
                <Settings size={18} />
              </button>
              {model.settingsOpen ? (
                <div
                  class={`absolute top-[38px] right-0 z-50 grid gap-2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)] ${props.settingsWide ? 'w-[min(384px,calc(100vw-16px))]' : 'min-w-[216px]'}`}
                  data-testid='reader-settings'
                >
                  {props.settings?.(() => actions.settings(false))}
                  <ReaderSetting label='Select'>
                    <Segmented
                      values={props.selectionModes}
                      value={mode}
                      onChange={(value) => {
                        readerPreferences.patch({ selectionMode: value as ReaderSelectionMode })
                        actions.clearSelection()
                        actions.settings(false)
                      }}
                    />
                  </ReaderSetting>
                  <ReaderSetting label='Default action'>
                    <Segmented
                      values={['define', 'translate', 'none']}
                      value={preferences.defaultAction}
                      onChange={(value) => {
                        readerPreferences.patch({ defaultAction: value as ReaderDefaultAction })
                        actions.settings(false)
                      }}
                    />
                  </ReaderSetting>
                  <ReaderSetting label='AI results'>
                    <Segmented
                      values={['compact', 'detailed']}
                      value={preferences.aiDetail}
                      onChange={(value) => {
                        readerPreferences.patch({ aiDetail: value as 'compact' | 'detailed' })
                        actions.settings(false)
                      }}
                    />
                  </ReaderSetting>
                </div>
              ) : null}
            </div>
          </div>
          {props.showClose ? (
            <button
              type='button'
              title='Close'
              aria-label='Close reader'
              class={`${buttonClass} col-start-3 row-start-1`}
              onClick={actions.close}
            >
              <X size={20} />
            </button>
          ) : null}
        </header>
        <div class='relative flex min-h-0 flex-1'>
          {preferences.outlineOpen ? props.outline : null}
          <div
            use={domBinding(actions.viewport, viewportBinding)}
            data-testid='reader-viewport'
            class={cn(
              'reader-viewport min-h-0 flex-1 overflow-auto bg-[#191919] px-2 pt-1 pb-2 [scrollbar-color:#555_#181818]',
              { 'cursor-text': mode === 'text' },
            )}
            onPointerDown={(event) => {
              actions.settings(false)
              if (!(event.target as Element).closest('[data-testid="reader-selection-menu"]'))
                actions.clearSelection()
            }}
            onScroll={(event) => {
              actions.scroll()
              props.onScroll?.(event.currentTarget)
            }}
          >
            {props.content(frame)}
          </div>
        </div>
        <Portal mount={model.menuHost}>
          {model.selection ? (
            <ReaderSelectionMenu
              selection={model.selection}
              defaultAction={preferences.defaultAction}
              aiDetail={preferences.aiDetail}
              onTextChange={actions.selectionText}
            />
          ) : null}
        </Portal>
      </div>
    )
  }),
})
