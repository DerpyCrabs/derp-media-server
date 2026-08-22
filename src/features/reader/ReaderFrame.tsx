import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import PanelLeft from 'lucide-solid/icons/panel-left'
import Settings from 'lucide-solid/icons/settings'
import X from 'lucide-solid/icons/x'
import { Portal } from '@solidjs/web'
import { Show, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { menuPositionForRect, visibleRectForRange } from './reader-geometry'
import { closeReader } from './reader-url'
import { ReaderSelectionMenu, type ReaderSelection } from './ReaderSelectionMenu'
import { ReaderSetting, Segmented } from './ReaderSettings'
import { useReaderPreferences } from './ReaderPreferences'
import type { ReaderDefaultAction, ReaderSelectionMode } from './reader-position'
import type { ReaderPresentation } from './reader-types'

let activeReaderRoot: HTMLElement | null = null

export type ReaderFrameContent = {
  viewport: () => HTMLDivElement | undefined
  selectionMode: () => ReaderSelectionMode
  selectRegion: (selection: Omit<ReaderSelection, 'id'>) => void
  clearSelection: () => void
}

type ReaderFrameProps = ReaderPresentation & {
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
  beforeClose?: () => Promise<void> | void
}

export function ReaderFrame(props: ReaderFrameProps) {
  const preferences = useReaderPreferences()
  let readerRoot: HTMLDivElement | undefined
  let viewport: HTMLDivElement | undefined
  const menuHost = document.createElement('div')
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [selection, setSelection] = createSignal<ReaderSelection | null>(null)
  let selectionId = 0
  let closed = false

  const selectionMode = createMemo<ReaderSelectionMode>(() => {
    const preferred = preferences.selectionMode()
    return props.selectionModes.includes(preferred)
      ? preferred
      : (props.selectionModes[0] ?? 'text')
  })
  const clearSelection = () => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }
  const frame: ReaderFrameContent = {
    viewport: () => viewport,
    selectionMode,
    selectRegion: (next) => setSelection({ ...next, id: ++selectionId }),
    clearSelection,
  }

  const close = async () => {
    await Promise.all([props.beforeClose?.(), preferences.flush()])
    closed = true
    if (props.onClose) props.onClose()
    else closeReader()
  }
  const toggleFullscreen = async () => {
    if (!readerRoot) return
    if (document.fullscreenElement === readerRoot) {
      await document.exitFullscreen()
      return
    }
    if (document.fullscreenElement) await document.exitFullscreen()
    await readerRoot.requestFullscreen()
  }
  const captureTextSelection = (pointer: { x: number; y: number }) => {
    if (selectionMode() !== 'text' || !viewport) return
    const nativeSelection = window.getSelection()
    if (!nativeSelection || nativeSelection.isCollapsed || nativeSelection.rangeCount === 0) return
    const range = nativeSelection.getRangeAt(0)
    const node = range.commonAncestorContainer
    const element = node instanceof Element ? node : node.parentElement
    if (!element || !viewport.contains(element)) return
    const text = nativeSelection.toString().replace(/\s+/g, ' ').trim()
    if (!text) return
    const menuRect = visibleRectForRange(
      range,
      nativeSelection.focusNode,
      nativeSelection.focusOffset,
      pointer,
      viewport,
    )
    if (!menuRect) return
    setSelection({
      id: ++selectionId,
      kind: 'text',
      text,
      ...menuPositionForRect(menuRect, viewport),
    })
  }
  const syncSelectionMenu = () => {
    const active = selection()
    if (!viewport) return
    if (active?.kind === 'image' && active.anchor?.isConnected && active.region) {
      const source = active.anchor.querySelector<HTMLCanvasElement | HTMLImageElement>(
        'canvas, img',
      )
      const bounds = active.anchor.getBoundingClientRect()
      const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source?.width
      const naturalHeight =
        source instanceof HTMLImageElement ? source.naturalHeight : source?.height
      if (naturalWidth && naturalHeight) {
        const rect = new DOMRect(
          bounds.left + (active.region.x / naturalWidth) * bounds.width,
          bounds.top + (active.region.y / naturalHeight) * bounds.height,
          (active.region.width / naturalWidth) * bounds.width,
          (active.region.height / naturalHeight) * bounds.height,
        )
        setSelection({ ...active, ...menuPositionForRect(rect, viewport) })
      }
      return
    }
    const nativeSelection = window.getSelection()
    if (
      active?.kind !== 'text' ||
      !nativeSelection ||
      nativeSelection.rangeCount === 0 ||
      nativeSelection.isCollapsed ||
      !nativeSelection.toString().trim()
    )
      return
    const rect = visibleRectForRange(
      nativeSelection.getRangeAt(0),
      nativeSelection.focusNode,
      nativeSelection.focusOffset,
      null,
      viewport,
    )
    if (rect) setSelection({ ...active, ...menuPositionForRect(rect, viewport) })
  }

  onSettled(() => {
    document.body.append(menuHost)
    if (!readerRoot) return
    const root = readerRoot
    if (!activeReaderRoot || !props.embedded) activeReaderRoot = root
    const fullscreenChange = () => {
      const active = document.fullscreenElement === root
      setFullscreen(active)
      if (active) root.append(menuHost)
      else if (menuHost.isConnected) document.body.append(menuHost)
    }
    let selectionCaptureFrame = 0
    const captureFromRelease = (event: MouseEvent | PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-testid="reader-selection-menu"]'))
        return
      window.cancelAnimationFrame(selectionCaptureFrame)
      selectionCaptureFrame = window.requestAnimationFrame(() =>
        untrack(() => {
          selectionCaptureFrame = 0
          captureTextSelection({ x: event.clientX, y: event.clientY })
        }),
      )
    }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const targetReader = target?.closest<HTMLElement>('[data-testid="reader-dialog"]')
      const ownsEvent = targetReader
        ? targetReader === root
        : document.fullscreenElement === root || activeReaderRoot === root
      if (!ownsEvent) return
      if (event.key === 'Escape') {
        if (props.onEscape?.()) return
        if (settingsOpen()) setSettingsOpen(false)
        else if (selection()) clearSelection()
        else if (!props.embedded || props.onClose) void close()
        return
      }
      if (target?.closest('[data-testid="reader-selection-menu"]')) return
      if (target?.closest('input, textarea, button, [contenteditable=true]')) return
      if (!viewport) return
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        viewport.scrollBy({ top: event.key === 'ArrowDown' ? 40 : -40 })
        return
      }
      props.onKeyDown?.(event, viewport)
    }
    document.addEventListener('fullscreenchange', fullscreenChange)
    document.addEventListener('pointerup', captureFromRelease)
    document.addEventListener('mouseup', captureFromRelease)
    document.addEventListener('keydown', keydown)
    onCleanup(() => {
      window.cancelAnimationFrame(selectionCaptureFrame)
      document.removeEventListener('fullscreenchange', fullscreenChange)
      document.removeEventListener('pointerup', captureFromRelease)
      document.removeEventListener('mouseup', captureFromRelease)
      document.removeEventListener('keydown', keydown)
    })
  })

  onCleanup(() => {
    if (!closed) void props.beforeClose?.()
    menuHost.remove()
    if (activeReaderRoot === readerRoot) activeReaderRoot = null
  })

  return (
    <div
      ref={(element) => {
        readerRoot = element
      }}
      role={props.embedded ? 'region' : 'dialog'}
      aria-modal={props.embedded ? undefined : 'true'}
      aria-label={`Reader: ${props.title}`}
      class={[
        'inset-0 flex flex-col bg-neutral-900 text-white',
        { 'fixed z-[70]': !props.embedded, 'absolute z-20': props.embedded },
      ]}
      data-testid='reader-dialog'
      onPointerDown={() => readerRoot && (activeReaderRoot = readerRoot)}
      onFocusIn={() => readerRoot && (activeReaderRoot = readerRoot)}
    >
      <header class='relative z-30 grid h-[39px] shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1.5 border-b border-[#303030] bg-[#121212] px-1.5 py-[3px]'>
        <Show when={props.outline}>
          <button
            type='button'
            aria-label='Toggle document outline'
            data-testid='reader-outline-button'
            class='col-start-1 flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
            onClick={() => preferences.setOutlineOpen((value) => !value)}
          >
            <PanelLeft size={18} />
          </button>
        </Show>
        <div class='col-start-2 row-start-1 flex min-w-0 items-center justify-center gap-1'>
          <button
            type='button'
            aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
            class='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
            onClick={() => void toggleFullscreen()}
          >
            <Show when={fullscreen()} fallback={<Maximize2 size={18} />}>
              <Minimize2 size={18} />
            </Show>
          </button>
          {props.toolbar}
          <div class='relative shrink-0'>
            <button
              type='button'
              aria-label='Reader settings'
              data-testid='reader-settings-button'
              class='flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings size={18} />
            </button>
            <Show when={settingsOpen()}>
              <div
                class={`absolute top-[38px] right-0 z-50 grid gap-2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)] ${
                  props.settingsWide ? 'w-[min(384px,calc(100vw-16px))]' : 'min-w-[216px]'
                }`}
                data-testid='reader-settings'
              >
                {props.settings?.(() => setSettingsOpen(false))}
                <ReaderSetting label='Select'>
                  <Segmented
                    values={props.selectionModes}
                    value={selectionMode()}
                    onChange={(value) => {
                      preferences.setSelectionMode(value as ReaderSelectionMode)
                      clearSelection()
                      setSettingsOpen(false)
                    }}
                  />
                </ReaderSetting>
                <ReaderSetting label='Default action'>
                  <Segmented
                    values={['define', 'translate', 'none']}
                    value={preferences.defaultAction()}
                    onChange={(value) => {
                      preferences.setDefaultAction(value as ReaderDefaultAction)
                      setSettingsOpen(false)
                    }}
                  />
                </ReaderSetting>
                <ReaderSetting label='AI results'>
                  <Segmented
                    values={['compact', 'detailed']}
                    value={preferences.aiDetail()}
                    onChange={(value) => {
                      preferences.setAiDetail(value as 'compact' | 'detailed')
                      setSettingsOpen(false)
                    }}
                  />
                </ReaderSetting>
              </div>
            </Show>
          </div>
        </div>
        <Show when={props.showClose}>
          <button
            type='button'
            title='Close'
            aria-label='Close reader'
            class='col-start-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
            onClick={() => void close()}
          >
            <X size={20} />
          </button>
        </Show>
      </header>
      <div class='relative flex min-h-0 flex-1'>
        <Show when={preferences.outlineOpen()}>{props.outline}</Show>
        <div
          ref={(element) => {
            viewport = element
            props.onViewport?.(element)
          }}
          data-testid='reader-viewport'
          class={[
            'reader-viewport min-h-0 flex-1 overflow-auto bg-[#191919] px-2 pt-1 pb-2 [scrollbar-color:#555_#181818]',
            { 'cursor-text': selectionMode() === 'text' },
          ]}
          onPointerDown={(event) => {
            setSettingsOpen(false)
            if (!(event.target as Element).closest('[data-testid="reader-selection-menu"]')) {
              setSelection(null)
            }
          }}
          onScroll={(event) => {
            syncSelectionMenu()
            props.onScroll?.(event.currentTarget)
          }}
        >
          {props.content(frame)}
        </div>
      </div>
      <Portal mount={menuHost}>
        <Show when={selection()}>
          {(active) => (
            <ReaderSelectionMenu
              selection={active()}
              defaultAction={preferences.defaultAction()}
              aiDetail={preferences.aiDetail()}
              onTextChange={(text) => setSelection((value) => (value ? { ...value, text } : null))}
            />
          )}
        </Show>
      </Portal>
    </div>
  )
}
