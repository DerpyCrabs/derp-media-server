import { Effect } from 'effect'

export const nextAnimationFrame = Effect.callback<void>((resume) => {
  const frame = requestAnimationFrame(() => resume(Effect.void))
  return Effect.sync(() => cancelAnimationFrame(frame))
})
