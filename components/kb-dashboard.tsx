'use client'

import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'

interface RecentFile {
  path: string
  name: string
  modifiedAt: string
}

interface KbDashboardProps {
  scopePath: string
  onFileClick: (path: string) => void
  fetchUrl?: string
}

async function fetchRecent(scopePath: string, fetchUrl?: string): Promise<RecentFile[]> {
  const url = fetchUrl || `/api/kb/recent?root=${encodeURIComponent(scopePath)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch recent')
  const data = await res.json()
  return data.results || []
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function KbDashboard({ scopePath, onFileClick, fetchUrl }: KbDashboardProps) {
  const { data: recent, isLoading } = useQuery({
    queryKey: ['kb-recent', fetchUrl || scopePath],
    queryFn: () => fetchRecent(scopePath, fetchUrl),
    staleTime: 1000 * 60,
  })

  if (isLoading || !recent?.length) {
    return null
  }

  return (
    <div className='border-b border-border bg-muted/20 px-1.5 py-1.5 md:px-2 md:py-2 shrink-0'>
      <div className='flex flex-wrap gap-1 md:gap-1.5'>
        {recent.map((file) => (
          <button
            key={file.path}
            type='button'
            onClick={() => onFileClick(file.path)}
            className='flex items-center gap-1 md:gap-1.5 px-1.5 py-1 md:px-2 md:py-1.5 rounded border border-border bg-background hover:bg-muted/50 transition-colors text-left min-w-0 max-w-full'
          >
            <FileText className='h-4 w-4 shrink-0 text-muted-foreground' />
            <span className='truncate text-sm font-medium'>{file.name}</span>
            <span className='text-xs text-muted-foreground shrink-0'>
              {formatRelativeTime(file.modifiedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
