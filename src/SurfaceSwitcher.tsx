import { For, type Accessor } from 'solid-js'
import { navigateHref } from './browser-history'
import { hrefForSurface, type AppRoute, type AppSurface } from './lib/routes'

const SURFACES: readonly { kind: AppSurface; label: string }[] = [
  { kind: 'library', label: 'Library' },
  { kind: 'workspace', label: 'Workspace' },
  { kind: 'canvas', label: 'Canvas' },
]

type Props = {
  route: Accessor<AppRoute>
}

function shouldUseClientNavigation(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

export function SurfaceSwitcher(props: Props) {
  function selectSurface(event: MouseEvent, surface: AppSurface) {
    if (!shouldUseClientNavigation(event)) return
    event.preventDefault()
    if (props.route().kind === surface) return
    navigateHref(hrefForSurface(surface, props.route()), 'push')
  }

  return (
    <nav
      aria-label='Application surfaces'
      data-testid='surface-switcher'
      class='fixed top-1/2 right-2 z-[105000] hidden -translate-y-1/2 flex-col items-stretch gap-0.5 rounded-lg border border-border bg-popover/95 p-0.5 text-popover-foreground shadow-md backdrop-blur md:flex'
    >
      <For each={SURFACES}>
        {(surface) => (
          <a
            href={hrefForSurface(surface.kind, props.route())}
            aria-current={props.route().kind === surface.kind ? 'page' : undefined}
            class={`rounded-md px-2 py-1 text-center text-xs font-medium transition-colors ${
              props.route().kind === surface.kind
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            onClick={(event) => selectSurface(event, surface.kind)}
          >
            {surface.label}
          </a>
        )}
      </For>
    </nav>
  )
}
