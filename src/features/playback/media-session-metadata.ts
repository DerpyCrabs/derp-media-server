import type { AudioMetadata } from './audio'
import type { PlaybackItem, PlaybackMode } from './types'

export type PlaybackMediaSessionMetadataInput = Readonly<{
  item: PlaybackItem
  mode: PlaybackMode
  album?: string
  artworkUrl?: string | null
  metadata?: AudioMetadata
  artworkBaseUrl?: string
}>

export function buildPlaybackMediaSessionMetadata(
  input: PlaybackMediaSessionMetadataInput,
): MediaMetadataInit {
  const isVideoAudio = input.item.media === 'video' && input.mode === 'audio'
  const result: MediaMetadataInit = {
    title: isVideoAudio ? `${input.item.name} (Audio)` : input.metadata?.title || input.item.name,
    artist: isVideoAudio ? 'Video Audio' : input.metadata?.artist || 'Unknown Artist',
    album: isVideoAudio
      ? input.album || 'Unknown Album'
      : input.metadata?.album || input.album || 'Unknown Album',
  }

  if (input.artworkUrl) {
    const src = input.artworkUrl.startsWith('data:')
      ? input.artworkUrl
      : input.artworkBaseUrl
        ? new URL(input.artworkUrl, input.artworkBaseUrl).href
        : input.artworkUrl
    result.artwork = [
      { src, sizes: '512x512', type: 'image/jpeg' },
      { src, sizes: '256x256', type: 'image/jpeg' },
      { src, sizes: '128x128', type: 'image/jpeg' },
    ]
  }

  return result
}
