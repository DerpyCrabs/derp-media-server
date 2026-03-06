import type { ReactNode } from 'react'

interface BrowserPaneContentProps {
  searchQuery: string
  searchResults: ReactNode
  loading?: boolean
  loadingFallback?: ReactNode
  dashboard?: ReactNode
  viewMode: 'list' | 'grid'
  listView: ReactNode
  gridView: ReactNode
}

export function BrowserPaneContent({
  searchQuery,
  searchResults,
  loading = false,
  loadingFallback = (
    <div className='flex items-center justify-center py-12 text-muted-foreground'>Loading...</div>
  ),
  dashboard,
  viewMode,
  listView,
  gridView,
}: BrowserPaneContentProps) {
  if (searchQuery.trim()) {
    return searchResults
  }

  if (loading) {
    return loadingFallback
  }

  return (
    <>
      {dashboard}
      {viewMode === 'list' ? listView : gridView}
    </>
  )
}
