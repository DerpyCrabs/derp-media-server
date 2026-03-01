'use client'

import { Search } from 'lucide-react'

interface SearchResult {
  path: string
  name: string
  snippet: string
}

interface KbSearchResultsProps {
  results: SearchResult[]
  query: string
  isLoading: boolean
  currentPath: string
  onResultClick: (path: string) => void
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function SnippetWithHighlight({ snippet, query }: { snippet: string; query: string }) {
  if (!query.trim()) return <>{snippet}</>
  const escaped = escapeRegex(query.trim())
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = snippet.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className='rounded bg-yellow-400/40 dark:bg-amber-500/40 px-0.5 ring-1 ring-amber-500/60 dark:ring-amber-400/50'
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
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

export function KbSearchResults({
  results,
  query,
  isLoading,
  currentPath,
  onResultClick,
}: KbSearchResultsProps) {
  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center py-16 text-muted-foreground'>
        <Search className='h-10 w-10 animate-pulse mb-4 opacity-50' />
        <p className='text-sm'>Searching...</p>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-16 text-muted-foreground'>
        <Search className='h-10 w-10 mb-4 opacity-50' />
        <p className='text-sm'>No results for &quot;{query}&quot;</p>
      </div>
    )
  }

  return (
    <div className='divide-y divide-border overflow-auto'>
      {results.map((result) => {
        const dirPath = result.path.includes('/')
          ? result.path.split('/').slice(0, -1).join('/')
          : ''
        const displayPath = pathRelativeTo(currentPath, dirPath)
        const showPath = displayPath && displayPath !== '.' && displayPath !== '..'
        return (
          <button
            key={result.path}
            type='button'
            onClick={() => onResultClick(result.path)}
            className='w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset'
          >
            <div className='font-medium truncate'>{result.name}</div>
            {showPath && (
              <div className='text-xs text-muted-foreground truncate mt-0.5'>{displayPath}</div>
            )}
            {result.snippet && (
              <div className='text-sm text-muted-foreground mt-1 line-clamp-2'>
                <SnippetWithHighlight snippet={result.snippet} query={query} />
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
