import type { ResourceKey } from '@/lib/domain/resource'

export type PlaybackMedia = 'audio' | 'video'
export type PlaybackMode = 'audio' | 'video'
export type PlaybackPhase =
  | 'idle'
  | 'resolving'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'
  | 'destroyed'

export type PlaybackResolveReason = 'load' | 'restore' | 'refresh' | 'retry' | 'mode'

export type PlaybackItem = Readonly<{
  resource: ResourceKey
  locator: string
  name: string
  media: PlaybackMedia
}>

export type PlaybackSource = Readonly<{
  url: string
  generation: number
}>

export type PlaybackSnapshot = Readonly<{
  revision: number
  phase: PlaybackPhase
  queue: readonly PlaybackItem[]
  currentIndex: number
  currentItem: PlaybackItem | null
  position: number
  duration: number
  desiredPlaying: boolean
  mode: PlaybackMode
  volume: number
  muted: boolean
  repeat: boolean
  source: PlaybackSource | null
  error: string | null
}>

export type PlaybackSourceRequest = Readonly<{
  item: PlaybackItem
  mode: PlaybackMode
  reason: PlaybackResolveReason
  signal: AbortSignal
}>

export type PlaybackSourceResolution =
  | Readonly<{ kind: 'resolved'; url: string; item?: PlaybackItem }>
  | Readonly<{ kind: 'error'; message: string }>

export interface PlaybackSourceResolver {
  resolve(
    request: PlaybackSourceRequest,
  ): PlaybackSourceResolution | Promise<PlaybackSourceResolution>
}

export type PlaybackCommand =
  | Readonly<{
      type: 'load'
      item: PlaybackItem
      queue?: readonly PlaybackItem[]
      autoplay?: boolean
      position?: number
      mode?: PlaybackMode
    }>
  | Readonly<{ type: 'setQueue'; queue: readonly PlaybackItem[]; current?: PlaybackItem }>
  | Readonly<{ type: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'retry' }>
  | Readonly<{ type: 'refreshSource' }>
  | Readonly<{ type: 'seek'; position: number }>
  | Readonly<{ type: 'mediaTime'; generation: number; position: number; duration?: number }>
  | Readonly<{ type: 'mediaDuration'; generation: number; duration: number }>
  | Readonly<{
      type: 'mediaReady' | 'mediaPlay' | 'mediaPause' | 'mediaEnded'
      generation: number
    }>
  | Readonly<{ type: 'mediaError'; generation: number; message?: string }>
  | Readonly<{ type: 'setMode'; mode: PlaybackMode }>
  | Readonly<{ type: 'setVolume'; volume: number }>
  | Readonly<{ type: 'setMuted'; muted: boolean }>
  | Readonly<{ type: 'setRepeat'; repeat: boolean }>
  | Readonly<{ type: 'toggleRepeat' | 'checkpoint' | 'stop' | 'destroy' }>

export type PlaybackOutcome = Readonly<{
  accepted: boolean
  changed: boolean
  reason?: 'destroyed' | 'emptyQueue' | 'staleSource' | 'invalid'
  generation?: number
}>

export type PersistedPlaybackState = Readonly<{
  schemaVersion: 1
  queue: readonly PlaybackItem[]
  currentIndex: number
  position: number
  duration: number
  mode: PlaybackMode
  volume: number
  muted: boolean
  repeat: boolean
}>

export interface PlaybackPersistence {
  load(): unknown
  save(state: PersistedPlaybackState): void
  clear?(): void
  legacyPosition?(locator: string): number | null
}

export interface PlaybackSession {
  getSnapshot(): PlaybackSnapshot
  subscribe(listener: () => void): () => void
  dispatch(command: PlaybackCommand): PlaybackOutcome
}

export type CreatePlaybackSessionOptions = Readonly<{
  sourceResolver: PlaybackSourceResolver
  persistence?: PlaybackPersistence
}>
