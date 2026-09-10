import type { QueryClient } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import type { PlaybackFallback, PlaybackSourceRequest, PlaybackSourceResolution } from './types'

export type VideoTrack = {
  id: string
  index: number | null
  codec: string
  language: string
  title: string
  default: boolean
  supported: boolean
}

export type VideoInfo = {
  fingerprint: string
  duration: number
  container: string
  video: {
    codec_name: string
    profile?: string
    level?: number
    pix_fmt?: string
    width: number
    height: number
    r_frame_rate?: string
    color_transfer?: string
  } | null
  audio: VideoTrack[]
  subtitles: VideoTrack[]
  allowVideoTranscoding: boolean
}

export type VideoPreferences = {
  global: { audioLanguage?: string; subtitleLanguage?: string; secondarySubtitleLanguage?: string }
  video: {
    speed?: number
    audioTrack?: string | null
    subtitleTrack?: string | null
    secondarySubtitleTrack?: string | null
  }
}

export function videoInfoQuery(path: string) {
  return {
    queryKey: ['video-info', path] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<VideoInfo>(`/api/playback/info?${new URLSearchParams({ path })}`, { signal }),
    staleTime: 30_000,
    retry: false,
  }
}

export function videoPreferencesQuery(path: string) {
  return {
    queryKey: ['playback-preferences', path] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<VideoPreferences>(`/api/playback/preferences?${new URLSearchParams({ path })}`, {
        signal,
      }),
    staleTime: 0,
  }
}

const languageAliases: Record<string, string> = {
  en: 'eng',
  ja: 'jpn',
  ru: 'rus',
  es: 'spa',
  fr: 'fre',
  fra: 'fre',
  de: 'ger',
  deu: 'ger',
  it: 'ita',
  pt: 'por',
  zh: 'chi',
  zho: 'chi',
  ko: 'kor',
}
export function normalizedLanguage(language: string) {
  return languageAliases[language.toLowerCase()] ?? language.toLowerCase()
}

export function preferredTrack(
  tracks: VideoTrack[],
  override: string | null | undefined,
  language: string | undefined,
  defaultAudio = false,
): VideoTrack | undefined {
  if (override === null && !defaultAudio) return undefined
  const available = tracks.filter((track) => track.supported)
  const explicit = override ? available.find((track) => track.id === override) : undefined
  if (explicit) return explicit
  const preferred = language
    ? available.find((track) => normalizedLanguage(track.language) === normalizedLanguage(language))
    : undefined
  return (
    preferred ??
    (defaultAudio ? (available.find((track) => track.default) ?? available[0]) : undefined)
  )
}

export function videoCodec(info: VideoInfo): string {
  const video = info.video
  if (!video) return ''
  switch (video.codec_name) {
    case 'h264': {
      const profile = video.profile?.includes('High 10')
        ? 110
        : video.profile?.includes('High')
          ? 100
          : video.profile?.includes('Main')
            ? 77
            : 66
      return `avc1.${profile.toString(16).padStart(2, '0')}00${(video.level ?? 40).toString(16).padStart(2, '0')}`
    }
    case 'hevc':
      return `hvc1.${video.profile?.includes('10') ? '2.4' : '1.6'}.L${video.level ?? 153}.B0`
    case 'vp8':
      return 'vp8'
    case 'vp9':
      return 'vp09.00.41.08'
    case 'av1':
      return 'av01.0.08M.08'
    default:
      return ''
  }
}

function supportsVideo(info: VideoInfo): boolean {
  if (!info.video) return true
  const codec = videoCodec(info)
  if (!codec) return false
  const container = ['vp8', 'vp9'].includes(info.video.codec_name) ? 'webm' : 'mp4'
  return document.createElement('video').canPlayType(`video/${container}; codecs="${codec}"`) !== ''
}

function supportsAudio(codec: string): boolean {
  const codecs: Record<string, string> = {
    aac: 'audio/mp4; codecs="mp4a.40.2"',
    mp3: 'audio/mpeg',
    opus: 'audio/webm; codecs="opus"',
    vorbis: 'audio/webm; codecs="vorbis"',
    flac: 'audio/flac',
    alac: 'audio/mp4; codecs="alac"',
    ac3: 'audio/mp4; codecs="ac-3"',
    eac3: 'audio/mp4; codecs="ec-3"',
    pcm_s16le: 'audio/wav; codecs="1"',
  }
  return !!codecs[codec] && document.createElement('audio').canPlayType(codecs[codec]) !== ''
}

export function chooseCompatibility(
  info: VideoInfo,
  selected: VideoTrack | undefined,
  fallback: PlaybackFallback,
  videoSupported: boolean,
  audioSupported: boolean,
): PlaybackFallback {
  if (fallback === 'video' || !videoSupported) return 'video'
  if (fallback === 'audio' || !audioSupported) return 'audio'
  if (
    fallback === 'remux' ||
    info.container.includes('mpegts') ||
    (selected &&
      (selected.id !== info.audio[0]?.id ||
        info.audio.some((track) => track.default && track.id !== selected.id)))
  )
    return 'remux'
  return 'original'
}

export async function resolveVideoSource(
  queryClient: QueryClient,
  request: PlaybackSourceRequest,
): Promise<PlaybackSourceResolution> {
  const path = request.item.locator
  const [info, preferences] = await Promise.all([
    queryClient.fetchQuery(videoInfoQuery(path)).catch(() => null),
    queryClient
      .fetchQuery(videoPreferencesQuery(path))
      .catch(() => ({ global: {}, video: {} }) as VideoPreferences),
  ])
  const playbackRate = preferences.video.speed ?? 1
  if (!info) {
    return {
      kind: 'resolved',
      url:
        request.mode === 'audio'
          ? `/api/audio/extract/${path.split('/').map(encodeURIComponent).join('/')}`
          : buildMediaUrl(path),
      playbackRate,
    }
  }
  const audio = preferredTrack(
    info.audio,
    preferences.video.audioTrack,
    preferences.global.audioLanguage,
    true,
  )
  const compatibility =
    request.mode === 'audio'
      ? 'audio'
      : chooseCompatibility(
          info,
          audio,
          request.fallback ?? 'original',
          supportsVideo(info),
          !audio || supportsAudio(audio.codec),
        )
  if (compatibility === 'video' && !info.allowVideoTranscoding) {
    return {
      kind: 'error',
      message:
        'This video needs conversion. Enable playback.allowVideoTranscoding in config.jsonc and restart the server.',
    }
  }
  const common = {
    duration: info.duration || undefined,
    playbackRate,
    expectedVideo: request.mode === 'video' && !!info.video,
    expectedAudio: !!audio,
    compatibility,
  }
  if (compatibility === 'original') return { kind: 'resolved', url: buildMediaUrl(path), ...common }
  const start = Math.max(
    0,
    Math.min(request.position ?? 0, info.duration > 0 ? Math.max(0, info.duration - 2) : Infinity),
  )
  const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const webm =
    request.mode === 'audio' ||
    (compatibility !== 'video' && ['vp8', 'vp9'].includes(info.video?.codec_name ?? ''))
  const copyAudio =
    !!audio &&
    supportsAudio(audio.codec) &&
    (webm
      ? ['opus', 'vorbis'].includes(audio.codec)
      : ['aac', 'mp3', 'flac', 'opus'].includes(audio.codec)) &&
    compatibility !== 'audio'
  const params = new URLSearchParams({
    path,
    video: String(compatibility === 'video'),
    audioOnly: String(request.mode === 'audio'),
    copyAudio: String(copyAudio),
    start: start.toFixed(3),
    id: requestId,
  })
  if (audio?.index !== null && audio?.index !== undefined) params.set('audio', String(audio.index))
  const outputVideoCodec =
    request.mode === 'audio' ? '' : compatibility === 'video' ? 'avc1.640033' : videoCodec(info)
  const outputAudioCodec = !audio
    ? ''
    : copyAudio
      ? ({ aac: 'mp4a.40.2', mp3: 'mp4a.69' }[audio.codec] ?? audio.codec)
      : webm
        ? 'opus'
        : 'mp4a.40.2'
  const codecs = [outputVideoCodec, outputAudioCodec].filter(Boolean).join(',')
  const mimeType = `${request.mode === 'audio' ? 'audio' : 'video'}/${webm ? 'webm' : 'mp4'}; codecs="${codecs}"`
  return {
    kind: 'resolved',
    url: `/api/playback/stream?${params}`,
    streaming: true,
    mimeType,
    requestId,
    ...common,
  }
}
