import { apiSchemaEffect } from '@/lib/api/client'
import { audioMetadataSchema } from './playback-schemas'
export type AudioMetadata = typeof audioMetadataSchema.Type

export const fetchAudioMetadataEffect = (url: string) => apiSchemaEffect(audioMetadataSchema, url)

export function formatPlaybackTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0:00'
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
