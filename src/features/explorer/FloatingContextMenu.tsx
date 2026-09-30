import { domBinding, localComponent, Portal, view, type JSX, type Snapshot } from 'effectweb'
import { getFloatingLayerMount } from '@/lib/ui/floating-layer-mount'
import {
  floatingPointerInsideSurface,
  registerFloatingDismissLayer,
} from '@/lib/ui/floating-layer-registry'
import {
  FLOATING_Z_BREADCRUMB_FOLDER_MENU,
  FLOATING_Z_CONTEXT_MENU,
  FLOATING_Z_PATH_MENU,
} from '@/lib/ui/floating-z-index'
import { clampFixedMenuPosition } from '@/lib/ui/clamp-fixed-menu'
import { cn } from '@/lib/ui/cn'
type CommonFloatingProps = {
  mount?: HTMLElement
  onDismiss: () => void
  zIndex?: number
  extraDismissRoots?: readonly (HTMLElement | null | undefined)[]
  dismissIgnoreInsideSelector?: string
  dismissIgnoreSelectorActive?: boolean
  'data-slot'?: string
  'data-testid'?: string
  class?: string
  role?: 'menu' | 'presentation'
  noWindowDrag?: boolean
  pinContextMenuRoot?: boolean
  breadcrumbFolderMenuSurface?: boolean
}
export type FloatingContextMenuAnchorProps = CommonFloatingProps & {
  open: boolean
  anchorRef: HTMLElement | null
  gap?: number
  minWidthMin?: number
  children: JSX.Element
}
export type FloatingContextMenuPointerProps<T> = CommonFloatingProps & {
  state: T | null | undefined
  anchor: (value: T) => { x: number; y: number }
  children: (value: T) => JSX.Element
}
export type FloatingContextMenuProps<T> =
  | FloatingContextMenuPointerProps<T>
  | FloatingContextMenuAnchorProps
type SurfaceProps = CommonFloatingProps & {
  anchorElement?: HTMLElement | null
  position?: { x: number; y: number }
  gap: number
  minWidth: number
  zIndex: number
  children: JSX.Element
}
const surfaceBinding = (element: HTMLDivElement, current: () => SurfaceProps) => {
  let frame = 0
  const apply = () => {
    const props = current()
    const anchor = props.anchorElement
    const rect = anchor?.getBoundingClientRect()
    if (rect) element.style.minWidth = `${Math.max(props.minWidth, rect.width)}px`
    element.style.left = '0px'
    element.style.top = '0px'
    const bounds = element.getBoundingClientRect()
    const position = clampFixedMenuPosition({
      preferredLeft: rect?.left ?? props.position?.x ?? 0,
      width: Math.max(bounds.width, 1),
      height: Math.max(bounds.height, 1),
      flip: {
        anchorTop: rect?.top ?? props.position?.y ?? 0,
        anchorBottom: rect?.bottom ?? props.position?.y ?? 0,
        gap: rect ? props.gap : 0,
      },
    })
    element.style.left = `${position.left}px`
    element.style.top = `${position.top}px`
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(apply)
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(element)
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)
  window.visualViewport?.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('scroll', schedule)
  const unregister = registerFloatingDismissLayer({
    zIndex: current().zIndex,
    isInside: (event) => {
      const props = current()
      return floatingPointerInsideSurface(
        event,
        element,
        [props.anchorElement, ...(props.extraDismissRoots ?? [])],
        props.dismissIgnoreInsideSelector,
        () => props.dismissIgnoreSelectorActive ?? false,
      )
    },
    dismiss: () => current().onDismiss(),
  })
  apply()
  return {
    update: schedule,
    dispose: () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      unregister()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    },
  }
}
const MenuSurface = localComponent({
  init: (props: Snapshot<SurfaceProps>) => ({ mount: props.mount ?? getFloatingLayerMount() }),
  view: view((model) => {
    const props = model.props
    return (
      <Portal mount={props.mount ?? model.mount}>
        <div
          use={domBinding(props, surfaceBinding)}
          data-floating-surface
          data-slot={props['data-slot']}
          data-testid={props['data-testid']}
          data-breadcrumb-folder-menu={props.breadcrumbFolderMenuSurface ? true : undefined}
          data-pin-context-menu={props.pinContextMenuRoot ? true : undefined}
          data-no-window-drag={props.noWindowDrag !== false ? true : undefined}
          class={cn(
            'fixed max-h-[calc(100dvh-16px)] min-w-36 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
            props.class,
          )}
          style={{ 'z-index': props.zIndex }}
          role={props.role ?? 'menu'}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {props.children}
        </div>
      </Portal>
    )
  }),
})
type FloatingMenuView = JSX.ComponentType & {
  <T>(this: never, props: FloatingContextMenuProps<T>): JSX.Element
}
export const FloatingContextMenu = view<FloatingContextMenuProps<unknown>>((props) => {
  if ('anchorRef' in props)
    return props.open ? (
      <MenuSurface
        {...props}
        anchorElement={props.anchorRef}
        gap={props.gap ?? 4}
        minWidth={props.minWidthMin ?? 192}
        zIndex={props.zIndex ?? FLOATING_Z_PATH_MENU}
      >
        {props.children}
      </MenuSurface>
    ) : null
  const state = props.state
  return state == null ? null : (
    <MenuSurface
      {...props}
      position={props.anchor(state)}
      gap={0}
      minWidth={0}
      zIndex={
        props.zIndex ??
        (props.breadcrumbFolderMenuSurface
          ? FLOATING_Z_BREADCRUMB_FOLDER_MENU
          : FLOATING_Z_CONTEXT_MENU)
      }
    >
      {props.children(state)}
    </MenuSurface>
  )
}) as unknown as FloatingMenuView
