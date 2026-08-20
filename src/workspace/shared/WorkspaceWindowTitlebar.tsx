import type { FileIconContext } from '@/features/explorer/use-file-icon'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import { WorkspaceTabStrip } from '@/workspace/tabs/WorkspaceTabStrip'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import Minus from 'lucide-solid/icons/minus'
import X from 'lucide-solid/icons/x'
import { Show, type Accessor } from 'solid-js'

export type WorkspaceWindowTitlebarProps = {
  groupId: string
  tabs: Accessor<WorkspaceWindowDefinition[]>
  visibleTabId: Accessor<string>
  active: boolean
  fileIconContext: () => FileIconContext
  maximized: Accessor<boolean>
  onRoot?: (element: HTMLDivElement) => void
  onPointerDown?: (event: PointerEvent) => void
  testId?: string
  rootTestId?: string
  height?: Accessor<number>
  actionSize?: Accessor<number>
  actionIconScale?: Accessor<number>
  rounded?: Accessor<boolean>
  showTabs?: Accessor<boolean>
  mergeHighlightInsertIndex?: Accessor<number | null>
  splitLeftTabId?: Accessor<string | null | undefined>
  onActivateTab?: (groupId: string, tabId: string) => void
  onFocusWindow: (windowId: string) => void
  onCloseTab?: (windowId: string) => void
  onToggleTabPinned?: (windowId: string) => void
  onTabPullStart?: (groupId: string, tabId: string, event: PointerEvent) => void
  onDropFile?: Parameters<typeof WorkspaceTabStrip>[0]['onDropFile']
  onExitSplitView?: () => void
  onUseAsSplitLeftTab?: (tabId: string) => void
  onMinimize?: () => void
  onToggleMaximize: () => void
  onOpenLayoutPicker?: (rect: DOMRect) => void
  onClose?: () => void
}

export function WorkspaceWindowTitlebar(props: WorkspaceWindowTitlebarProps) {
  const action =
    'inline-flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
  const actionStyle = () => ({ width: props.actionSize ? `${props.actionSize()}px` : undefined })
  const iconStyle = () => ({
    transform: props.actionIconScale ? `scale(${props.actionIconScale()})` : undefined,
  })

  return (
    <div
      ref={(element) => props.onRoot?.(element)}
      data-testid={props.rootTestId}
      class={`relative z-10 flex shrink-0 items-stretch border-b border-border ${props.height ? '' : 'h-8'} ${
        props.rounded?.() ? 'rounded-t-lg' : ''
      } ${props.active ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground'}`}
      style={{ height: props.height ? `${props.height()}px` : undefined }}
      onPointerDown={(event) => props.onPointerDown?.(event)}
    >
      <Show when={props.showTabs?.() ?? true} fallback={<span class='flex-1' />}>
        <div
          data-testid={props.testId}
          class='workspace-window-drag-handle flex min-w-0 flex-1 cursor-grab items-center text-xs font-medium select-none active:cursor-grabbing'
        >
          <WorkspaceTabStrip
            groupId={props.groupId}
            tabs={props.tabs}
            visibleTabId={props.visibleTabId}
            isWindowActive={props.active}
            fileIconContext={props.fileIconContext}
            onActivateTab={(groupId, tabId) => props.onActivateTab?.(groupId, tabId)}
            onFocusWindow={props.onFocusWindow}
            onCloseTab={(windowId) => props.onCloseTab?.(windowId)}
            onToggleTabPinned={props.onToggleTabPinned}
            onTabPullStart={props.onTabPullStart}
            onDropFile={props.onDropFile}
            mergeHighlightInsertIndex={props.mergeHighlightInsertIndex}
            splitLeftTabId={props.splitLeftTabId?.() ?? null}
            onExitSplitView={props.onExitSplitView}
            onUseAsSplitLeftTab={props.onUseAsSplitLeftTab}
          />
        </div>
      </Show>
      <div
        class='workspace-window-drag-handle min-w-[48px] shrink-0 cursor-grab active:cursor-grabbing'
        aria-hidden='true'
      />
      <div
        data-no-window-drag
        class='workspace-window-buttons flex shrink-0 items-stretch'
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Show when={props.onMinimize}>
          <button
            type='button'
            class={action}
            style={actionStyle()}
            onClick={() => props.onMinimize?.()}
            aria-label='Minimize'
          >
            <span style={iconStyle()}>
              <Minus class='h-3.5 w-3.5' stroke-width={2} />
            </span>
          </button>
        </Show>
        <Show
          when={props.onOpenLayoutPicker}
          fallback={
            <button
              type='button'
              class={action}
              style={actionStyle()}
              onClick={() => props.onToggleMaximize()}
              aria-label={props.maximized() ? 'Restore' : 'Maximize'}
              title={props.maximized() ? 'Restore window' : 'Maximize window'}
            >
              <Show
                when={props.maximized()}
                fallback={
                  <span style={iconStyle()}>
                    <Maximize2 class='h-3.5 w-3.5' stroke-width={2} />
                  </span>
                }
              >
                <span style={iconStyle()}>
                  <Minimize2 class='h-3.5 w-3.5' stroke-width={2} />
                </span>
              </Show>
            </button>
          }
        >
          <div class='flex h-full w-8'>
            <button
              type='button'
              data-layout-picker-trigger
              class='inline-flex h-full w-5 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              onClick={() => props.onToggleMaximize()}
              onContextMenu={(event) => {
                event.preventDefault()
                props.onOpenLayoutPicker?.(event.currentTarget.getBoundingClientRect())
              }}
              aria-label='Maximize'
              title={props.maximized() ? 'Restore window' : 'Maximize window'}
            >
              <Show
                when={props.maximized()}
                fallback={<Maximize2 class='h-3.5 w-3.5' stroke-width={2} />}
              >
                <Minimize2 class='h-3.5 w-3.5' stroke-width={2} />
              </Show>
            </button>
            <button
              type='button'
              data-layout-picker-trigger
              class='inline-flex h-full w-3 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              onClick={(event) =>
                props.onOpenLayoutPicker?.(event.currentTarget.getBoundingClientRect())
              }
              aria-label='Choose window layout'
              title='Choose window layout'
            >
              <ChevronDown class='h-2.5 w-2.5' stroke-width={2} />
            </button>
          </div>
        </Show>
        <Show when={props.onClose}>
          <button
            type='button'
            class={action}
            style={actionStyle()}
            onClick={() => props.onClose?.()}
            aria-label={`Close ${props.tabs().find((window) => window.id === props.visibleTabId())?.title ?? ''}`}
          >
            <span style={iconStyle()}>
              <X class='h-3.5 w-3.5' stroke-width={2} />
            </span>
          </button>
        </Show>
      </div>
    </div>
  )
}
