'use client'

import { useQuery } from '@tanstack/react-query'
import { AudioMetadata } from './types'

async function fetchAudioMetadata(filePath: string): Promise<AudioMetadata> {
  const response = await fetch(`/api/audio/metadata/${filePath}`)
  if (!response.ok) {
    throw new Error('Failed to fetch audio metadata')
  }
  return response.json()
}

export function useAudioMetadata(filePath: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['audio-metadata', 'v2', filePath], // v2 to bust cache after base64 fix
    queryFn: () => fetchAudioMetadata(filePath!),
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    gcTime: 1000 * 60 * 15, // Keep in cache for 15 minutes
    enabled: enabled && !!filePath, // Only fetch when enabled and filePath exists
    refetchOnWindowFocus: false, // Audio metadata doesn't change often
  })
}
