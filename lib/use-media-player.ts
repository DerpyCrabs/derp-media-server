import { batch } from 'solid-js'
import { createStore } from 'solid-js/store'
import { createStoreListeners } from './client-store-utils'

type MediaType = 'audio' | 'video' | null

interface MediaPlayerData {
  currentFile: string | null
  mediaType: MediaType
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isRepeat: boolean
  shareToken: string | null
  sharePath: string | null
}

const listeners = createStoreListeners()

const [store, setStore] = createStore<MediaPlayerData>({
  currentFile: null,
  mediaType: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  isRepeat: false,
  shareToken: null,
  sharePath: null,
})

function playFile(path: string, type: 'audio' | 'video') {
  if (store.currentFile === path && store.mediaType === type) {
    setStore('isPlaying', !store.isPlaying)
  } else {
    batch(() => {
      setStore('currentFile', path)
      setStore('mediaType', type)
      setStore('currentTime', 0)
      setStore('duration', 0)
      setStore('isPlaying', true)
    })
  }
  listeners.notify()
}

function startOrResumePlayback(path: string, type: 'audio' | 'video') {
  if (store.currentFile === path && store.mediaType === type) {
    setStore('isPlaying', true)
  } else {
    batch(() => {
      setStore('currentFile', path)
      setStore('mediaType', type)
      setStore('currentTime', 0)
      setStore('duration', 0)
      setStore('isPlaying', true)
    })
  }
  listeners.notify()
}

function setCurrentFile(path: string, type: 'audio' | 'video') {
  if (store.currentFile !== path || store.mediaType !== type) {
    const samePath = store.currentFile === path
    batch(() => {
      setStore('currentFile', path)
      setStore('mediaType', type)
      if (!samePath) {
        setStore('currentTime', 0)
        setStore('duration', 0)
      }
    })
    listeners.notify()
  }
}

function setIsPlaying(playing: boolean) {
  setStore('isPlaying', playing)
  listeners.notify()
}

function setCurrentTime(time: number) {
  setStore('currentTime', time)
  listeners.notify()
}

function setDuration(duration: number) {
  setStore('duration', duration)
  listeners.notify()
}

function setVolume(volume: number) {
  batch(() => {
    setStore('volume', volume)
    setStore('isMuted', volume === 0)
  })
  listeners.notify()
}

function setMuted(muted: boolean) {
  batch(() => {
    setStore('isMuted', muted)
    setStore('volume', muted ? 0 : store.volume || 0.5)
  })
  listeners.notify()
}

function toggleRepeat() {
  setStore('isRepeat', !store.isRepeat)
  listeners.notify()
}

function setShareContext(token: string, path: string) {
  batch(() => {
    setStore('shareToken', token)
    setStore('sharePath', path)
  })
  listeners.notify()
}

function clearShareContext() {
  batch(() => {
    setStore('shareToken', null)
    setStore('sharePath', null)
  })
  listeners.notify()
}

function reset() {
  batch(() => {
    setStore('currentFile', null)
    setStore('mediaType', null)
    setStore('isPlaying', false)
    setStore('currentTime', 0)
    setStore('duration', 0)
    setStore('volume', 1)
    setStore('isMuted', false)
  })
  listeners.notify()
}

const api = {
  get currentFile() {
    return store.currentFile
  },
  get mediaType() {
    return store.mediaType
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
  get shareToken() {
    return store.shareToken
  },
  get sharePath() {
    return store.sharePath
  },
  playFile,
  startOrResumePlayback,
  setCurrentFile,
  setIsPlaying,
  setCurrentTime,
  setDuration,
  setVolume,
  setMuted,
  toggleRepeat,
  setShareContext,
  clearShareContext,
  reset,
}

export const useMediaPlayer = {
  getState: () => api,
  subscribe: listeners.subscribe,
}
