import type { FileSearchResult } from '@/lib/file-search'
import AppWindow from 'lucide-solid/icons/app-window'
import Bot from 'lucide-solid/icons/bot'
import Download from 'lucide-solid/icons/download'
import FolderHeart from 'lucide-solid/icons/folder-heart'
import Home from 'lucide-solid/icons/house'
import LayoutGrid from 'lucide-solid/icons/layout-grid'
import Library from 'lucide-solid/icons/library'
import Map from 'lucide-solid/icons/map'
import Menu from 'lucide-solid/icons/menu'
import Settings from 'lucide-solid/icons/settings'
import { For, Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { FileSearchButton } from '../FileSearchPalette'
import { hrefFor, type RouteQuery, type RouteTarget } from '../lib/routes'
import { executeOwnerSearchResult } from './owner-search-open'
import { PlaybackAudioHost } from '../media/playback/PlaybackAudioHost'

export type OwnerSurface =
  | 'home'
  | 'library'
  | 'spaces'
  | 'workspace'
  | 'canvas'
  | 'assistant'
  | 'shared'
  | 'offline'
  | 'settings'

type Props = {
  active: OwnerSurface
  children: JSX.Element
  immersive?: boolean
  navigate: (href: string) => void
}

function ownerHref(target: RouteTarget, query?: RouteQuery) {
  return hrefFor(target, query)
}

const desktopDestinations = [
  { id: 'home' as const, href: ownerHref({ kind: 'home' }), label: 'Home', icon: Home },
  { id: 'library' as const, href: ownerHref({ kind: 'library' }), label: 'Library', icon: Library },
  { id: 'spaces' as const, href: ownerHref({ kind: 'spaces' }), label: 'Spaces', icon: LayoutGrid },
  {
    id: 'workspace' as const,
    href: ownerHref({ kind: 'workspace' }),
    label: 'Workspace',
    icon: AppWindow,
  },
  { id: 'canvas' as const, href: ownerHref({ kind: 'canvas' }), label: 'Canvas', icon: Map },
  {
    id: 'assistant' as const,
    href: ownerHref({ kind: 'assistant' }),
    label: 'Assistant',
    icon: Bot,
  },
  {
    id: 'shared' as const,
    href: ownerHref({ kind: 'library' }, { dir: 'Shares' }),
    label: 'Shared',
    icon: FolderHeart,
  },
  {
    id: 'offline' as const,
    href: ownerHref({ kind: 'offline' }),
    label: 'Offline',
    icon: Download,
  },
  {
    id: 'settings' as const,
    href: ownerHref({ kind: 'settings' }),
    label: 'Settings',
    icon: Settings,
  },
]

function anchorClick(event: MouseEvent, href: string, navigate: (href: string) => void) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  navigate(href)
}

export function OwnerShell(props: Props) {
  const [moreOpen, setMoreOpen] = createSignal(false)
  const [fullscreen, setFullscreen] = createSignal(!!document.fullscreenElement)

  createEffect(() => {
    const syncFullscreen = () => setFullscreen(!!document.fullscreenElement)
    const beginNativeFullscreen = () => setFullscreen(true)
    const endNativeFullscreen = () => setFullscreen(false)
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('webkitbeginfullscreen', beginNativeFullscreen, true)
    document.addEventListener('webkitendfullscreen', endNativeFullscreen, true)
    onCleanup(() => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('webkitbeginfullscreen', beginNativeFullscreen, true)
      document.removeEventListener('webkitendfullscreen', endNativeFullscreen, true)
    })
  })

  function navigate(href: string) {
    setMoreOpen(false)
    props.navigate(href)
  }

  function chooseSearchResult(result: FileSearchResult) {
    executeOwnerSearchResult(result, navigate)
  }

  return (
    <div
      class='owner-shell-modern min-h-screen bg-background text-foreground'
      classList={{
        'owner-shell-fullscreen': fullscreen(),
        'owner-shell-immersive': !!props.immersive,
      }}
      data-owner-shell
    >
      <Show when={!fullscreen() && !props.immersive}>
        <aside
          class='fixed inset-y-0 left-0 z-[100010] hidden w-[4.75rem] flex-col items-center border-r border-border bg-card/95 py-2 backdrop-blur md:flex'
          aria-label='Owner navigation'
          data-testid='owner-desktop-rail'
        >
          <a
            href={ownerHref({ kind: 'library' })}
            aria-label='Derp Desk Library'
            class='mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground'
            onClick={(event) => anchorClick(event, ownerHref({ kind: 'library' }), navigate)}
          >
            <span class='text-sm font-black'>DD</span>
          </a>
          <nav class='flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto'>
            <For each={desktopDestinations}>
              {(item) => (
                <a
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={props.active === item.id ? 'page' : undefined}
                  class='flex size-11 shrink-0 flex-col items-center justify-center rounded-lg text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground'
                  onClick={(event) => anchorClick(event, item.href, navigate)}
                >
                  <Dynamic component={item.icon} class='size-4' aria-hidden='true' />
                  <span class='mt-0.5 max-w-full truncate px-0.5'>{item.label}</span>
                </a>
              )}
            </For>
            <FileSearchButton
              title='Search'
              label='Search'
              class='flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              iconClass='size-4'
              testId='owner-desktop-search'
              onSelect={chooseSearchResult}
            />
          </nav>
        </aside>

        <Show when={moreOpen()}>
          <div
            class='fixed inset-0 z-[100018] bg-black/25 md:hidden'
            role='presentation'
            onClick={() => setMoreOpen(false)}
          />
          <nav
            class='fixed right-2 bottom-[calc(var(--owner-shell-mobile-nav-height)+0.5rem)] left-2 z-[100019] grid grid-cols-2 gap-1 rounded-xl border border-border bg-popover p-2 shadow-xl md:hidden'
            aria-label='More destinations'
            data-testid='owner-more-menu'
          >
            <For
              each={desktopDestinations.filter(
                (item) => item.id !== 'library' && item.id !== 'spaces',
              )}
            >
              {(item) => (
                <a
                  href={item.href}
                  class='hover:bg-muted flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm'
                  onClick={(event) => anchorClick(event, item.href, navigate)}
                >
                  <Dynamic component={item.icon} class='size-4' aria-hidden='true' />
                  {item.label}
                </a>
              )}
            </For>
          </nav>
        </Show>

        <nav
          class='fixed inset-x-0 bottom-0 z-[100020] grid h-[var(--owner-shell-mobile-nav-height)] grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden'
          aria-label='Owner navigation'
          data-testid='owner-phone-nav'
        >
          <a
            href={ownerHref({ kind: 'library' })}
            data-owner-phone-target
            aria-current={props.active === 'library' ? 'page' : undefined}
            class='flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground aria-[current=page]:text-primary'
            onClick={(event) => anchorClick(event, ownerHref({ kind: 'library' }), navigate)}
          >
            <Library class='size-5' aria-hidden='true' />
            Library
          </a>
          <a
            href='/spaces'
            data-owner-phone-target
            aria-current={props.active === 'spaces' ? 'page' : undefined}
            class='flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground aria-[current=page]:text-primary'
            onClick={(event) => anchorClick(event, '/spaces', navigate)}
          >
            <LayoutGrid class='size-5' aria-hidden='true' />
            Spaces
          </a>
          <FileSearchButton
            title='Search'
            label='Search'
            class='flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground'
            iconClass='size-5'
            testId='owner-phone-search'
            onSelect={chooseSearchResult}
          />
          <button
            type='button'
            data-owner-phone-target
            aria-label='More'
            aria-expanded={moreOpen()}
            class='flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground aria-expanded:text-primary'
            onClick={() => setMoreOpen((open) => !open)}
          >
            <Menu class='size-5' aria-hidden='true' />
            More
          </button>
        </nav>
      </Show>

      <div class='owner-shell-content min-w-0'>{props.children}</div>
      <PlaybackAudioHost />
    </div>
  )
}
