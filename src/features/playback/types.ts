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
export type PlaybackFallback = 'original' | 'remux' | 'audio' | 'video'

export type PlaybackItem = Readonly<{
  locator: string
  name: string
  media: PlaybackMedia
  automatic?: boolean
}>

export type RadioOptions = Readonly<{
  seeds: string[]
  genre: string
  artist: string
  discovery: number
  strictGenre: boolean
  allowRepeats: boolean
}>

export type QueueContext = Readonly<{
  kind: 'manual' | 'playlist' | 'radio'
  title: string
  id?: string
  radio?: RadioOptions
}>

export type PlaybackSource = Readonly<{
  url: string
  generation: number
  initialPosition?: number
  streaming?: boolean
  mimeType?: string
  duration?: number
  compatibility?: PlaybackFallback
  requestId?: string
  expectedVideo?: boolean
  expectedAudio?: boolean
}>

export type PlaybackSnapshot = Readonly<{
  revision: number
  phase: PlaybackPhase
  queue: readonly PlaybackItem[]
  queueContext: QueueContext | null
  currentIndex: number
  currentItem: PlaybackItem | null
  position: number
  duration: number
  pendingSeek: Readonly<{ id: number; position: number }> | null
  buffering: boolean
  desiredPlaying: boolean
  mode: PlaybackMode
  volume: number
  muted: boolean
  repeat: boolean
  playbackRate: number
  source: PlaybackSource | null
  error: string | null
}>

export type PlaybackSourceRequest = Readonly<{
  item: PlaybackItem
  mode: PlaybackMode
  reason: PlaybackResolveReason
  signal: AbortSignal
  position?: number
  fallback?: PlaybackFallback
}>

export type PlaybackSourceResolution =
  | Readonly<
      { kind: 'resolved'; item?: PlaybackItem; playbackRate?: number } & Omit<
        PlaybackSource,
        'generation'
      >
    >
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
      queueContext?: QueueContext | null
      autoplay?: boolean
      position?: number
      mode?: PlaybackMode
    }>
  | Readonly<{
      type: 'setQueue'
      queue: readonly PlaybackItem[]
      current?: PlaybackItem
      queueContext?: QueueContext | null
    }>
  | Readonly<{ type: 'setQueueContext'; context: QueueContext | null }>
  | Readonly<{ type: 'enqueue'; items: readonly PlaybackItem[]; position: 'next' | 'end' }>
  | Readonly<{ type: 'moveQueueItem'; from: number; to: number }>
  | Readonly<{ type: 'removeQueueItem' | 'selectQueueItem'; index: number }>
  | Readonly<{ type: 'shuffleQueue' }>
  | Readonly<{ type: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'retry' }>
  | Readonly<{ type: 'refreshSource'; fallback?: PlaybackFallback }>
  | Readonly<{ type: 'seek'; position: number }>
  | Readonly<{ type: 'mediaTime'; generation: number; position: number; duration?: number }>
  | Readonly<{ type: 'mediaSeeked'; generation: number; seekId: number; position: number }>
  | Readonly<{
      type: 'mediaVolume'
      generation: number
      volume: number
      muted: boolean
    }>
  | Readonly<{ type: 'mediaDuration'; generation: number; duration: number }>
  | Readonly<{ type: 'mediaBuffering'; generation: number; buffering: boolean }>
  | Readonly<{
      type: 'mediaReady' | 'mediaPlay' | 'mediaPause' | 'mediaEnded'
      generation: number
    }>
  | Readonly<{ type: 'mediaError'; generation: number; message?: string }>
  | Readonly<{ type: 'setMode'; mode: PlaybackMode }>
  | Readonly<{ type: 'setVolume'; volume: number }>
  | Readonly<{ type: 'setPlaybackRate'; rate: number }>
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
  queueContext?: QueueContext | null
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
