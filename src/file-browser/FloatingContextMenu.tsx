import { getFloatingLayerMount } from '@/lib/floating-layer-mount'
import {
  floatingPointerInsideSurface,
  registerFloatingDismissLayer,
} from '@/lib/floating-layer-registry'
import {
  FLOATING_Z_BREADCRUMB_FOLDER_MENU,
  FLOATING_Z_CONTEXT_MENU,
  FLOATING_Z_PATH_MENU,
} from '@/lib/floating-z-index'
import { clampFixedMenuPosition } from '@/lib/clamp-fixed-menu'
import { cn } from '@/lib/utils'
import type { Accessor, JSX } from 'solid-js'
import { Match, Show, Switch, createEffect, createSignal, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'

const MENU_ROOT_CLASS =
  'fixed min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'

type Positioning =
  | { kind: 'pointer'; left: number; top: number }
  | {
      kind: 'anchor'
      anchorRef: Accessor<HTMLElement | null>
      gap: number
      minWidthMin: number
    }

type MenuSurfaceProps = {
  positioning: Positioning
  trackScroll: boolean
  zIndex: number
  onDismiss: () => void
  extraDismissRoots?: Accessor<Array<HTMLElement | null | undefined>>
  dismissIgnoreInsideSelector?: string
  dismissIgnoreSelectorActive?: () => boolean
  'data-slot'?: string
  'data-testid'?: string
  class?: string
  role?: 'menu'
  noWindowDrag?: boolean
  pinContextMenuRoot?: boolean
  breadcrumbFolderMenuSurface?: boolean
  children: JSX.Element
}

function MenuSurface(props: MenuSurfaceProps) {
  const [surfaceRef, setSurfaceRef] = createSignal<HTMLDivElement | null>(null)

  createEffect(() => {
    const el = surfaceRef()
    if (!el) return
    const apply = () => {
      let preferredLeft: number
      let flip: { anchorTop: number; anchorBottom: number; gap: number }
      const pos = props.positioning
      if (pos.kind === 'pointer') {
        preferredLeft = pos.left
        flip = { anchorTop: pos.top, anchorBottom: pos.top, gap: 0 }
      } else {
        const anchor = pos.anchorRef()
        if (!anchor) return
        const ar = anchor.getBoundingClientRect()
        el.style.minWidth = `${Math.max(pos.minWidthMin, ar.width)}px`
        preferredLeft = ar.left
        flip = { anchorTop: ar.top, anchorBottom: ar.bottom, gap: pos.gap }
      }
      const r = el.getBoundingClientRect()
      const next = clampFixedMenuPosition({
        preferredLeft,
        width: Math.max(r.width, 1),
        height: Math.max(r.height, 1),
        flip,
      })
      el.style.left = `${next.left}px`
      el.style.top = `${next.top}px`
    }
    requestAnimationFrame(apply)
    const ro = new ResizeObserver(() => requestAnimationFrame(apply))
    ro.observe(el)
    const bump = () => requestAnimationFrame(apply)
    window.addEventListener('resize', bump)
    const vv = window.visualViewport
    if (props.trackScroll) {
      window.addEventListener('scroll', bump, true)
      vv?.addEventListener('resize', bump)
      vv?.addEventListener('scroll', bump)
    }
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener('resize', bump)
      if (props.trackScroll) {
        window.removeEventListener('scroll', bump, true)
        vv?.removeEventListener('resize', bump)
        vv?.removeEventListener('scroll', bump)
      }
    })
  })

  createEffect(() => {
    const surface = surfaceRef()
    if (!surface) return
    return registerFloatingDismissLayer({
      zIndex: props.zIndex,
      isInside: (e) => {
        const el = surfaceRef()
        if (!el) return false
        return floatingPointerInsideSurface(
          e,
          el,
          props.extraDismissRoots?.() ?? [],
          props.dismissIgnoreInsideSelector,
          props.dismissIgnoreSelectorActive,
        )
      },
      dismiss: () => props.onDismiss(),
    })
  })

  const initialPos = () => {
    const pos = props.positioning
    if (pos.kind === 'pointer') return { left: pos.left, top: pos.top }
    return { left: 0, top: 0 }
  }

  const floatingMount = getFloatingLayerMount()

  return (
    <Portal mount={floatingMount}>
      <div
        ref={(e) => setSurfaceRef(e ?? null)}
        data-floating-surface
        data-slot={props['data-slot']}
        data-testid={props['data-testid']}
        data-breadcrumb-folder-menu={props.breadcrumbFolderMenuSurface ? true : undefined}
        data-pin-context-menu={props.pinContextMenuRoot ? true : undefined}
        data-no-window-drag={props.noWindowDrag !== false ? true : undefined}
        class={cn(MENU_ROOT_CLASS, props.class)}
        style={{
          left: `${initialPos().left}px`,
          top: `${initialPos().top}px`,
          'z-index': props.zIndex,
        }}
        role={props.role ?? 'menu'}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </Portal>
  )
}

type CommonFloatingProps = {
  onDismiss: () => void
  zIndex?: number
  extraDismissRoots?: Accessor<Array<HTMLElement | null | undefined>>
  dismissIgnoreInsideSelector?: string
  dismissIgnoreSelectorActive?: () => boolean
  'data-slot'?: string
  'data-testid'?: string
  class?: string
  role?: 'menu'
  noWindowDrag?: boolean
  pinContextMenuRoot?: boolean
  breadcrumbFolderMenuSurface?: boolean
}

export type FloatingContextMenuAnchorProps = CommonFloatingProps & {
  open: Accessor<boolean>
  anchorRef: Accessor<HTMLElement | null>
  gap?: number
  minWidthMin?: number
  children: JSX.Element
}

export type FloatingContextMenuPointerProps<T> = CommonFloatingProps & {
  state: Accessor<T | null | undefined>
  anchor: (value: T) => { x: number; y: number }
  children: (value: T) => JSX.Element
}

export type FloatingContextMenuProps<T> =
  | FloatingContextMenuPointerProps<T>
  | FloatingContextMenuAnchorProps

function FloatingContextMenuAnchorBranch(props: FloatingContextMenuAnchorProps) {
  const roots = () => [props.anchorRef(), ...(props.extraDismissRoots?.() ?? [])]
  return (
    <Show when={props.open()}>
      <MenuSurface
        positioning={{
          kind: 'anchor',
          anchorRef: props.anchorRef,
          gap: props.gap ?? 4,
          minWidthMin: props.minWidthMin ?? 192,
        }}
        trackScroll
        zIndex={props.zIndex ?? FLOATING_Z_PATH_MENU}
        onDismiss={props.onDismiss}
        extraDismissRoots={roots}
        dismissIgnoreInsideSelector={props.dismissIgnoreInsideSelector}
        dismissIgnoreSelectorActive={props.dismissIgnoreSelectorActive}
        data-slot={props['data-slot']}
        data-testid={props['data-testid']}
        class={props.class}
        role={props.role}
        noWindowDrag={props.noWindowDrag}
        pinContextMenuRoot={props.pinContextMenuRoot}
        breadcrumbFolderMenuSurface={props.breadcrumbFolderMenuSurface}
      >
        {props.children}
      </MenuSurface>
    </Show>
  )
}

function FloatingContextMenuPointerBranch<T>(props: FloatingContextMenuPointerProps<T>) {
  return (
    <Show when={props.state()} keyed>
      {(value) => {
        const a = props.anchor(value)
        return (
          <MenuSurface
            positioning={{ kind: 'pointer', left: a.x, top: a.y }}
            trackScroll={false}
            zIndex={
              props.zIndex ??
              (props.breadcrumbFolderMenuSurface
                ? FLOATING_Z_BREADCRUMB_FOLDER_MENU
                : FLOATING_Z_CONTEXT_MENU)
            }
            onDismiss={props.onDismiss}
            extraDismissRoots={props.extraDismissRoots}
            dismissIgnoreInsideSelector={props.dismissIgnoreInsideSelector}
            dismissIgnoreSelectorActive={props.dismissIgnoreSelectorActive}
            data-slot={props['data-slot']}
            data-testid={props['data-testid']}
            class={props.class}
            role={props.role}
            noWindowDrag={props.noWindowDrag}
            pinContextMenuRoot={props.pinContextMenuRoot}
            breadcrumbFolderMenuSurface={props.breadcrumbFolderMenuSurface}
          >
            {props.children(value)}
          </MenuSurface>
        )
      }}
    </Show>
  )
}

export function FloatingContextMenu<T>(props: FloatingContextMenuProps<T>): JSX.Element {
  return (
    <Switch>
      <Match when={'anchorRef' in props}>
        <FloatingContextMenuAnchorBranch {...(props as FloatingContextMenuAnchorProps)} />
      </Match>
      <Match when={!('anchorRef' in props)}>
        <FloatingContextMenuPointerBranch {...(props as FloatingContextMenuPointerProps<T>)} />
      </Match>
    </Switch>
  )
}
