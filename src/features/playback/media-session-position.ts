export type PlaybackMediaSessionPosition = Readonly<{
  duration: number
  position: number
  playbackRate: number
}>

export type PlaybackMediaSessionPositionTarget = Readonly<{
  setPositionState?: (state: PlaybackMediaSessionPosition) => void
}>

/** Keep platform media controls synchronized without passing invalid state to the browser. */
export function setPlaybackMediaSessionPosition(
  target: PlaybackMediaSessionPositionTarget | undefined,
  input: PlaybackMediaSessionPosition,
): void {
  if (!target?.setPositionState) return
  if (!Number.isFinite(input.duration) || input.duration <= 0) return
  if (!Number.isFinite(input.position) || !Number.isFinite(input.playbackRate)) return

  const position = Math.min(Math.max(input.position, 0), input.duration)
  const playbackRate = input.playbackRate > 0 ? input.playbackRate : 1
  try {
    target.setPositionState({
      duration: input.duration,
      position,
      playbackRate,
    })
  } catch {
    // Browsers throw when a media element changes duration between events.
  }
}
