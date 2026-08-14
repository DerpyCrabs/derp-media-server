export type TranscriptScrollFollow = Readonly<{
  shouldFollow(): boolean
  stop(waitForAway: boolean): void
  observe(atBottom: boolean): void
  resume(): void
}>

export function createTranscriptScrollFollow(initial = true): TranscriptScrollFollow {
  let following = initial
  let waitingForAway = false

  return Object.freeze({
    shouldFollow: () => following,
    stop(waitForAway) {
      following = false
      waitingForAway = waitForAway
    },
    observe(atBottom) {
      if (!atBottom) {
        following = false
        waitingForAway = false
      } else if (!waitingForAway) {
        following = true
      }
    },
    resume() {
      following = true
      waitingForAway = false
    },
  })
}
