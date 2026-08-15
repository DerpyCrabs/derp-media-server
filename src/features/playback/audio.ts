export type AudioMetadata = {
  title?: string
  artist?: string
  album?: string
  coverArt?: string | null
  duration?: number
}

export async function fetchAudioMetadata(url: string): Promise<AudioMetadata> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch audio metadata')
  return response.json() as Promise<AudioMetadata>
}

export function formatPlaybackTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0:00'
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
