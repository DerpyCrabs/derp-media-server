export type PlaybackProgressScope = 'owner' | 'grant'

type PlaybackProgressPersistence = Readonly<{
  getSavedTime(path: string): number | null
  saveTime(path: string, time: number, duration: number): void
}>

export type OwnerPlaybackProgress = Readonly<{
  load(path: string, scope: PlaybackProgressScope): number | null
  save(time: number, duration: number): void
  release(time: number, duration: number): void
}>

export function createOwnerPlaybackProgress(
  persistence: PlaybackProgressPersistence,
): OwnerPlaybackProgress {
  let loadedOwnerPath: string | null = null

  const persistLoaded = (time: number, duration: number) => {
    if (!loadedOwnerPath || !Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
      return
    }
    persistence.saveTime(loadedOwnerPath, time, duration)
  }

  return {
    load(path, scope) {
      loadedOwnerPath = scope === 'owner' && path ? path : null
      return loadedOwnerPath ? persistence.getSavedTime(loadedOwnerPath) : null
    },
    save(time, duration) {
      persistLoaded(time, duration)
    },
    release(time, duration) {
      try {
        persistLoaded(time, duration)
      } finally {
        loadedOwnerPath = null
      }
    },
  }
}
