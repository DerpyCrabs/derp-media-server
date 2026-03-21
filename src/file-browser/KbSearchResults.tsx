import Search from 'lucide-solid/icons/search'
import { For, Index, Show } from 'solid-js'

type SearchResult = { path: string; name: string; snippet: string }

type Props = {
  results: SearchResult[]
  query: string
  isLoading: boolean
  currentPath: string
  onResultClick: (path: string) => void
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function snippetSegments(snippet: string, query: string): { text: string; hl: boolean }[] {
  const q = query.trim()
  if (!q) return [{ text: snippet, hl: false }]
  const regex = new RegExp(`(${escapeRegex(q)})`, 'gi')
  const parts = snippet.split(regex)
  return parts.map((text, i) => ({ text, hl: i % 2 === 1 }))
}

function pathRelativeTo(from: string, to: string): string {
  const fromParts = from ? from.split('/').filter(Boolean) : []
  const toParts = to.split('/').filter(Boolean)
  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++
  const up = fromParts.length - i
  const rest = toParts.slice(i)
  return [...Array(up).fill('..'), ...rest].join('/') || '.'
}

export function KbSearchResults(props: Props) {
  return (
    <Show
      when={!props.isLoading}
      fallback={
        <div class='flex flex-col items-center justify-center py-16 text-muted-foreground'>
          <Search class='mb-4 h-10 w-10 animate-pulse opacity-50' stroke-width={2} />
          <p class='text-sm'>Searching...</p>
        </div>
      }
    >
      <Show
        when={props.results.length > 0}
        fallback={
          <div class='flex flex-col items-center justify-center py-16 text-muted-foreground'>
            <Search class='mb-4 h-10 w-10 opacity-50' stroke-width={2} />
            <p class='text-sm'>No results for &quot;{props.query}&quot;</p>
          </div>
        }
      >
        <div class='divide-y divide-border overflow-auto'>
          <For each={props.results}>
            {(result) => {
              const dirPath = () =>
                result.path.includes('/') ? result.path.split('/').slice(0, -1).join('/') : ''
              const displayPath = () => pathRelativeTo(props.currentPath, dirPath())
              const showPath = () => {
                const d = displayPath()
                return d && d !== '.' && d !== '..'
              }
              return (
                <button
                  type='button'
                  class='w-full px-3 py-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset'
                  onClick={() => props.onResultClick(result.path)}
                >
                  <div class='truncate font-medium'>{result.name}</div>
                  <Show when={showPath()}>
                    <div class='mt-0.5 truncate text-xs text-muted-foreground'>{displayPath()}</div>
                  </Show>
                  <Show when={result.snippet}>
                    <div class='mt-1 line-clamp-2 text-sm text-muted-foreground'>
                      <Index each={snippetSegments(result.snippet, props.query)}>
                        {(seg) => (
                          <Show when={seg().hl} fallback={seg().text}>
                            <mark class='rounded bg-yellow-400/40 px-0.5 ring-1 ring-amber-500/60 dark:bg-amber-500/40 dark:ring-amber-400/50'>
                              {seg().text}
                            </mark>
                          </Show>
                        )}
                      </Index>
                    </div>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </Show>
  )
}
