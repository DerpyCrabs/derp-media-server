import { useQuery } from '@tanstack/react-query'
import { AudioMetadata } from './types'
import { queryKeys } from './query-keys'

async function fetchAudioMetadata(url: string): Promise<AudioMetadata> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch audio metadata')
  }
  return response.json()
}

export function useAudioMetadata(
  filePath: string | null,
  enabled: boolean = true,
  metadataUrl?: string | null,
) {
  const url = metadataUrl || (filePath ? `/api/audio/metadata/${filePath}` : null)
  return useQuery({
    queryKey: queryKeys.audioMetadata(filePath!),
    queryFn: () => fetchAudioMetadata(url!),
    enabled: enabled && !!filePath && !!url,
    refetchOnWindowFocus: false,
  })
}
