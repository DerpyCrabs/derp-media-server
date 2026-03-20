import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { GlobalSettings } from '@/lib/use-settings'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { cn } from '@/lib/utils'
import { createMemo, For, Match, Show, Switch } from 'solid-js'
import { useBrowserHistory, navigateSearchParams } from './browser-history'

function IconList(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-list', props.class)}
    >
      <path d='M3 12h.01' />
      <path d='M3 18h.01' />
      <path d='M3 6h.01' />
      <path d='M8 12h13' />
      <path d='M8 18h13' />
      <path d='M8 6h13' />
    </svg>
  )
}

function IconLayoutGrid(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-layout-grid', props.class)}
    >
      <rect width='7' height='7' x='3' y='3' rx='1' />
      <rect width='7' height='7' x='14' y='3' rx='1' />
      <rect width='7' height='7' x='14' y='14' rx='1' />
      <rect width='7' height='7' x='3' y='14' rx='1' />
    </svg>
  )
}

function IconHome(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-home shrink-0', props.class)}
    >
      <path d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' />
      <polyline points='9 22 9 12 15 12 15 22' />
    </svg>
  )
}

function IconChevronRight(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-chevron-right shrink-0 text-muted-foreground', props.class)}
    >
      <path d='m9 18 6-6-6-6' />
    </svg>
  )
}

function IconArrowUp(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-arrow-up text-muted-foreground', props.class)}
    >
      <path d='m18 15-6-6-6 6' />
    </svg>
  )
}

function IconFolder(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-folder text-muted-foreground', props.class)}
    >
      <path d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' />
    </svg>
  )
}

function IconFile(props: { class?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn('lucide lucide-file text-muted-foreground', props.class)}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
    </svg>
  )
}

function IconStar(props: { class?: string; filled?: boolean }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill={props.filled ? 'currentColor' : 'none'}
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={cn(
        'lucide lucide-star',
        props.filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground',
        props.class,
      )}
    >
      <path d='M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.878L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z' />
    </svg>
  )
}

function listRowIcon(file: FileItem) {
  if (file.isDirectory) return <IconFolder class='h-5 w-5' />
  if (file.type === MediaType.VIDEO) {
    return (
      <svg
        xmlns='http://www.w3.org/2000/svg'
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
        class='lucide lucide-file-play text-muted-foreground h-5 w-5'
      >
        <path d='M12.6 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7.357' />
        <path d='M14 2v4h4' />
        <path d='m10 11 5 3-5 3z' />
      </svg>
    )
  }
  if (file.type === MediaType.AUDIO) {
    return (
      <svg
        xmlns='http://www.w3.org/2000/svg'
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
        class='lucide lucide-music text-muted-foreground h-5 w-5'
      >
        <path d='M9 18V5l12-2v13' />
        <circle cx='6' cy='18' r='3' />
        <circle cx='18' cy='16' r='3' />
      </svg>
    )
  }
  if (file.type === MediaType.IMAGE) {
    return (
      <svg
        xmlns='http://www.w3.org/2000/svg'
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
        class='lucide lucide-image text-muted-foreground h-5 w-5'
      >
        <rect width='18' height='18' x='3' y='3' rx='2' ry='2' />
        <circle cx='9' cy='9' r='2' />
        <path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
      </svg>
    )
  }
  return <IconFile class='h-5 w-5' />
}

function gridHeroIcon(file: FileItem) {
  return <div class='scale-[2.5] [&_svg]:h-6 [&_svg]:w-6'>{listRowIcon(file)}</div>
}

function navigateToFolder(path: string | null) {
  navigateSearchParams({ dir: path === '' || path == null ? null : path }, 'push')
}

function Breadcrumbs(props: { currentPath: string; onNavigate: (path: string) => void }) {
  const crumbs = createMemo(() => {
    const parts = props.currentPath ? props.currentPath.split(/[/\\]/).filter(Boolean) : []
    return [
      { name: 'Home', path: '' },
      ...parts.map((part, index) => ({
        name: part,
        path: parts.slice(0, index + 1).join('/'),
      })),
    ]
  })

  return (
    <nav class='flex items-center gap-1 lg:gap-2 flex-wrap min-w-0 flex-1' aria-label='Breadcrumb'>
      <For each={crumbs()}>
        {(crumb, index) => (
          <div class='flex items-center gap-2'>
            <Show when={index() > 0}>
              <IconChevronRight class='h-4 w-4' />
            </Show>
            <button
              type='button'
              class={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-8 px-2.5 shrink-0',
                index() === crumbs().length - 1
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={() => props.onNavigate(crumb.path)}
            >
              <Show when={index() === 0}>
                <IconHome class='h-4 w-4' />
              </Show>
              {crumb.name}
            </button>
          </div>
        )}
      </For>
    </nav>
  )
}

function ViewModeToggle(props: {
  viewMode: 'list' | 'grid'
  onChange: (m: 'list' | 'grid') => void
}) {
  return (
    <div class='flex gap-1 items-center'>
      <button
        type='button'
        class={cn(
          'h-8 w-8 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'list'
            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
            : 'text-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        onClick={() => props.onChange('list')}
        aria-label='List view'
      >
        <IconList class='h-4 w-4' />
      </button>
      <button
        type='button'
        class={cn(
          'h-8 w-8 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'grid'
            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
            : 'text-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        onClick={() => props.onChange('grid')}
        aria-label='Grid view'
      >
        <IconLayoutGrid class='h-4 w-4' />
      </button>
    </div>
  )
}

export function FileBrowser() {
  const history = useBrowserHistory()
  const queryClient = useQueryClient()

  const currentPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(currentPath()),
    queryFn: () =>
      api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentPath())}`),
  }))

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
  }))

  const files = createMemo(() => filesQuery.data?.files ?? [])

  const viewMode = createMemo(() => {
    const s = settingsQuery.data
    return s?.viewModes?.[currentPath()] ?? 'list'
  })

  const favorites = createMemo(() => settingsQuery.data?.favorites ?? [])
  const favoriteSet = createMemo(() => new Set(favorites()))

  const viewModeMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; viewMode: 'list' | 'grid' }) =>
      post('/api/settings/viewMode', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const favoriteMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES) })
    },
  }))

  function handleParentDirectory() {
    if (isVirtualFolder()) {
      navigateToFolder(null)
      return
    }
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    if (parts.length > 0) {
      const parentPath = parts.slice(0, -1).join('/')
      navigateToFolder(parentPath || null)
    }
  }

  function handleBreadcrumbNavigate(path: string) {
    navigateToFolder(path || null)
  }

  function handleFileClick(file: FileItem) {
    if (file.isDirectory) {
      navigateToFolder(file.path)
    }
  }

  function setViewMode(mode: 'list' | 'grid') {
    viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  return (
    <div class='min-h-screen' data-testid='solid-home'>
      <div class='container mx-auto lg:p-4'>
        <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none lg:rounded-xl py-0 text-sm shadow-xs ring-1'>
          <div class='shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'>
            <div class='flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'>
              <Breadcrumbs currentPath={currentPath()} onNavigate={handleBreadcrumbNavigate} />
              <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
            </div>
          </div>

          <div class='flex flex-col min-h-0 flex-1 overflow-hidden'>
            <Show when={filesQuery.isError}>
              <div class='p-4'>
                <p class='text-destructive text-sm'>Failed to load files.</p>
              </div>
            </Show>

            <Switch>
              <Match when={viewMode() === 'grid'}>
                <div class='py-4 px-4'>
                  <div class='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
                    <Show when={currentPath()}>
                      <div
                        class='ring-foreground/10 bg-card text-card-foreground cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 rounded-xl text-left shadow-xs ring-1 overflow-hidden flex flex-col'
                        onClick={handleParentDirectory}
                        onKeyDown={(e) => e.key === 'Enter' && handleParentDirectory()}
                        role='button'
                        tabindex={0}
                      >
                        <div class='flex aspect-video flex-col items-center justify-center p-4 bg-muted/80'>
                          <IconArrowUp class='mb-2 h-12 w-12 text-muted-foreground' />
                          <p class='text-center text-sm font-medium'>..</p>
                          <p class='text-center text-xs text-muted-foreground'>Parent Folder</p>
                        </div>
                      </div>
                    </Show>
                    <For each={files()}>
                      {(file) => {
                        const isFav = () => favoriteSet().has(file.path)
                        return (
                          <div
                            class={cn(
                              'ring-foreground/10 bg-card text-card-foreground cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 rounded-xl text-left shadow-xs ring-1 overflow-hidden flex flex-col',
                            )}
                            onClick={() => handleFileClick(file)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFileClick(file)}
                            role='button'
                            tabindex={0}
                          >
                            <div class='group relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                              <Show when={!file.isDirectory}>
                                <button
                                  type='button'
                                  class={cn(
                                    'absolute top-1.5 left-1.5 z-10 rounded-full p-1 transition-all',
                                    isFav()
                                      ? 'bg-background/90 shadow-sm hover:bg-background'
                                      : 'bg-background/70 opacity-60 hover:bg-background/90 group-hover:opacity-100',
                                  )}
                                  title={isFav() ? 'Remove from favorites' : 'Add to favorites'}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    favoriteMutation.mutate({ filePath: file.path })
                                  }}
                                >
                                  <IconStar class='h-3.5 w-3.5' filled={isFav()} />
                                </button>
                              </Show>
                              <div class='text-muted-foreground'>{gridHeroIcon(file)}</div>
                            </div>
                            <div class='flex flex-col gap-1 p-3'>
                              <p class='truncate text-sm font-medium' title={file.name}>
                                {file.name}
                              </p>
                              <div class='flex items-center justify-end text-xs text-muted-foreground'>
                                <span>{file.isDirectory ? '' : formatFileSize(file.size)}</span>
                              </div>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </div>
              </Match>
              <Match when={viewMode() === 'list'}>
                <div class='sm:px-4 py-2'>
                  <div class='relative w-full overflow-x-auto'>
                    <table class='w-full caption-bottom text-sm'>
                      <tbody class='[&_tr:last-child]:border-0'>
                        <Show when={currentPath()}>
                          <tr
                            class='border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none'
                            onClick={handleParentDirectory}
                          >
                            <td class='w-12 p-2 align-middle'>
                              <div class='flex items-center justify-center'>
                                <IconArrowUp class='h-5 w-5' />
                              </div>
                            </td>
                            <td class='p-2 align-middle font-medium'>..</td>
                            <td class='p-2 align-middle text-right text-muted-foreground' />
                          </tr>
                        </Show>
                        <For each={files()}>
                          {(file) => {
                            const isFav = () => favoriteSet().has(file.path)
                            return (
                              <tr
                                class='border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none group'
                                onClick={() => handleFileClick(file)}
                              >
                                <td class='w-12 p-2 align-middle'>
                                  <div class='flex items-center justify-center'>
                                    {listRowIcon(file)}
                                  </div>
                                </td>
                                <td class='p-2 align-middle font-medium'>
                                  <div class='flex items-center gap-2 min-w-0'>
                                    <Show when={!file.isDirectory}>
                                      <button
                                        type='button'
                                        class='shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100 transition-opacity inline-flex'
                                        title={
                                          isFav() ? 'Remove from favorites' : 'Add to favorites'
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          favoriteMutation.mutate({ filePath: file.path })
                                        }}
                                      >
                                        <IconStar class='h-4 w-4' filled={isFav()} />
                                      </button>
                                    </Show>
                                    <span class='truncate'>{file.name}</span>
                                  </div>
                                </td>
                                <td class='p-2 align-middle text-right text-muted-foreground'>
                                  <span class='inline-block w-20 tabular-nums'>
                                    {file.isDirectory ? '' : formatFileSize(file.size)}
                                  </span>
                                </td>
                              </tr>
                            )
                          }}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </div>
  )
}
