import { createStore } from 'solid-js/store'
import { createStoreListeners } from './client-store-utils'

export interface WorkspaceAudioSessionSlice {
  playing: string | null
  audioOnly: boolean
  dir: string | null
}

interface WorkspaceAudioState extends WorkspaceAudioSessionSlice {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isRepeat: boolean
  /** Bumps when starting playback from a stopped taskbar (playing was null); forces `<audio>` reload in WorkspaceTaskbarAudio. */
  playNonce: number
}

const listeners = createStoreListeners()
const progressListeners = createStoreListeners()

/** Set from click handlers so `<audio>.play()` runs under user activation (see WorkspaceTaskbarAudio). */
let userGestureTransportPath: string | null = null

const [store, setStore] = createStore<WorkspaceAudioState>({
  playing: null,
  audioOnly: false,
  dir: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  isRepeat: false,
  playNonce: 0,
})

function sessionSlice(): WorkspaceAudioSessionSlice {
  return {
    playing: store.playing,
    audioOnly: store.audioOnly,
    dir: store.dir,
  }
}

function setCurrentTime(time: number) {
  setStore('currentTime', time)
  progressListeners.notify()
}

/** Select audio track and start transport. */
function playAudio(path: string, dir?: string) {
  const prev = store.playing
  setStore('playing', path)
  if (prev !== path) {
    if (prev == null) {
      setStore('playNonce', store.playNonce + 1)
    }
    setStore('audioOnly', false)
    setStore('duration', 0)
    setCurrentTime(0)
  }
  setStore('isPlaying', true)
  if (dir !== undefined) setStore('dir', dir || null)
  listeners.notify()
}

/** Same as legacy `workspace-playback-store.playFile` — `key` ignored. */
function playFile(_key: string | undefined, path: string, dir?: string) {
  playAudio(path, dir)
}

function closePlayer(_key?: string) {
  setStore('playing', null)
  setStore('audioOnly', false)
  setStore('dir', null)
  setStore('isPlaying', false)
  setCurrentTime(0)
  setStore('duration', 0)
  setStore('volume', 1)
  setStore('isMuted', false)
  listeners.notify()
}

function setAudioOnly(_key: string | undefined, enabled: boolean) {
  setStore('audioOnly', enabled)
  listeners.notify()
}

function startOrResumePlayback(path: string) {
  if (store.playing === path) {
    setStore('isPlaying', true)
  } else {
    setStore('playing', path)
    setStore('duration', 0)
    setCurrentTime(0)
    setStore('isPlaying', true)
  }
  listeners.notify()
}

/** Legacy taskbar `playFile`: toggle pause when same file, else switch. */
function toggleOrSelectFile(path: string) {
  if (store.playing === path) {
    setStore('isPlaying', !store.isPlaying)
  } else {
    setStore('playing', path)
    setStore('duration', 0)
    setCurrentTime(0)
    setStore('isPlaying', true)
    userGestureTransportPath = path
  }
  listeners.notify()
}

function setCurrentFile(path: string) {
  if (store.playing !== path) {
    setStore('playing', path)
    setStore('duration', 0)
    setCurrentTime(0)
    listeners.notify()
  }
}

function setIsPlaying(playing: boolean) {
  setStore('isPlaying', playing)
  listeners.notify()
}

function setDuration(duration: number) {
  setStore('duration', duration)
  progressListeners.notify()
}

function setVolume(volume: number) {
  setStore('volume', volume)
  setStore('isMuted', volume === 0)
  listeners.notify()
}

function setMuted(muted: boolean) {
  setStore('isMuted', muted)
  setStore('volume', muted ? 0 : store.volume || 0.5)
  listeners.notify()
}

function toggleRepeat() {
  setStore('isRepeat', !store.isRepeat)
  listeners.notify()
}

/** Transport-only clear; keeps `playing` / `dir` / `audioOnly`. */
function reset() {
  setStore('isPlaying', false)
  setCurrentTime(0)
  setStore('duration', 0)
  setStore('volume', 1)
  setStore('isMuted', false)
  listeners.notify()
}

function armUserGestureTransport(path: string) {
  userGestureTransportPath = path
}

function takeUserGestureTransport(): string | null {
  const p = userGestureTransportPath
  userGestureTransportPath = null
  return p
}

function byKeyProxy(): Record<string, WorkspaceAudioSessionSlice> {
  return new Proxy({} as Record<string, WorkspaceAudioSessionSlice>, {
    get() {
      return sessionSlice()
    },
  })
}

const api = {
  get playing() {
    return store.playing
  },
  get audioOnly() {
    return store.audioOnly
  },
  get dir() {
    return store.dir
  },
  get isPlaying() {
    return store.isPlaying
  },
  get currentTime() {
    return store.currentTime
  },
  get duration() {
    return store.duration
  },
  get volume() {
    return store.volume
  },
  get isMuted() {
    return store.isMuted
  },
  get isRepeat() {
    return store.isRepeat
  },
  get playNonce() {
    return store.playNonce
  },
  get byKey() {
    return byKeyProxy()
  },
  playAudio,
  playFile,
  closePlayer,
  setAudioOnly,
  startOrResumePlayback,
  toggleOrSelectFile,
  setCurrentFile,
  setIsPlaying,
  setCurrentTime,
  setDuration,
  setVolume,
  setMuted,
  toggleRepeat,
  reset,
  armUserGestureTransport,
  takeUserGestureTransport,
}

export const useWorkspaceAudio = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
  subscribeProgress: (fn: () => void) => progressListeners.subscribe(fn),
}
