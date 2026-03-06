import { useCallback } from 'react'
import { useMediaPlayer } from '@/lib/use-media-player'

function stripSharePrefix(filePath: string, sharePath: string | null): string {
  if (!sharePath) return filePath
  const norm = filePath.replace(/\\/g, '/')
  const base = sharePath.replace(/\\/g, '/')
  if (norm === base) return '.'
  return norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm
}

function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

export function useMediaUrl() {
  const shareToken = useMediaPlayer((s) => s.shareToken)
  const sharePath = useMediaPlayer((s) => s.sharePath)

  const getMediaUrl = useCallback(
    (filePath: string) => {
      if (!shareToken) return `/api/media/${filePath}`
      const relative = stripSharePrefix(filePath, sharePath)
      return `/api/share/${shareToken}/media/${encodeSegments(relative)}`
    },
    [shareToken, sharePath],
  )

  const getAudioExtractUrl = useCallback(
    (filePath: string) => {
      if (!shareToken) return `/api/audio/extract/${filePath}`
      const relative = stripSharePrefix(filePath, sharePath)
      return `/api/share/${shareToken}/audio/extract/${encodeSegments(relative)}`
    },
    [shareToken, sharePath],
  )

  const getAudioMetadataUrl = useCallback(
    (filePath: string) => {
      if (!shareToken) return `/api/audio/metadata/${filePath}`
      const relative = stripSharePrefix(filePath, sharePath)
      return `/api/share/${shareToken}/audio/metadata/${encodeSegments(relative)}`
    },
    [shareToken, sharePath],
  )

  const getDownloadUrl = useCallback(
    (filePath: string) => {
      if (!shareToken) return `/api/files/download?path=${encodeURIComponent(filePath)}`
      const relative = stripSharePrefix(filePath, sharePath)
      return `/api/share/${shareToken}/download?path=${encodeURIComponent(relative)}`
    },
    [shareToken, sharePath],
  )

  const getThumbnailUrl = useCallback(
    (filePath: string) => {
      if (!shareToken) return `/api/thumbnail/${filePath}`
      const relative = stripSharePrefix(filePath, sharePath)
      return `/api/share/${shareToken}/thumbnail/${encodeSegments(relative)}`
    },
    [shareToken, sharePath],
  )

  return {
    getMediaUrl,
    getAudioExtractUrl,
    getAudioMetadataUrl,
    getDownloadUrl,
    getThumbnailUrl,
    shareToken,
    sharePath,
  }
}
