'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface ViewStats {
  views: Record<string, number>
  shareViews: Record<string, number>
}

async function fetchViewStats(): Promise<ViewStats> {
  const response = await fetch('/api/stats/views')
  if (!response.ok) {
    throw new Error('Failed to fetch view stats')
  }
  return response.json()
}

async function incrementViewCount(filePath: string): Promise<{ viewCount: number }> {
  const response = await fetch('/api/stats/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  })
  if (!response.ok) {
    throw new Error('Failed to increment view count')
  }
  return response.json()
}

export function useViewStats() {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['viewStats'],
    queryFn: fetchViewStats,
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
  })

  const incrementMutation = useMutation({
    mutationFn: incrementViewCount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['viewStats'] })
    },
  })

  const views = data?.views || {}
  const shareViews = data?.shareViews || {}

  const incrementView = (filePath: string) => {
    incrementMutation.mutate(filePath)
  }

  const getViewCount = (filePath: string): number => {
    return views[filePath] || 0
  }

  const getShareViewCount = (filePath: string): number => {
    return shareViews[filePath] || 0
  }

  return {
    views,
    shareViews,
    incrementView,
    getViewCount,
    getShareViewCount,
  }
}
