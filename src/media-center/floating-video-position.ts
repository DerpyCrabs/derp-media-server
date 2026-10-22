import { Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { readPersistedState, writePersistedState } from '@/lib/state/client-store-utils'

interface Position {
  x: number
  y: number
}

const STORAGE_KEY = 'video-player-position'

const defaultPosition: Position = { x: 0, y: 0 }

export const floatingVideoPositionSchema = Schema.Struct({
  position: Schema.Struct({
    x: Schema.Number.check(Schema.isFinite()),
    y: Schema.Number.check(Schema.isFinite()),
  }),
})
const owner = modelOwner({
  position:
    readPersistedState(STORAGE_KEY, floatingVideoPositionSchema)?.position ?? defaultPosition,
})

function persist(position: Position) {
  writePersistedState(STORAGE_KEY, { position: { ...position } })
}

function setPosition(position: Position) {
  owner.patch({ position: { ...position } })
  persist(position)
}

function resetPosition() {
  owner.patch({ position: { ...defaultPosition } })
  persist(defaultPosition)
}

export const floatingVideoPosition = {
  source: owner.source,
  read: () => owner.read(),
  setPosition,
  resetPosition,
}

export function validatePosition(position: Position, size = { width: 320, height: 230 }): Position {
  if (typeof window === 'undefined') return position

  const constrainedX = Math.max(0, Math.min(position.x, window.innerWidth - size.width))
  const constrainedY = Math.max(0, Math.min(position.y, window.innerHeight - size.height))

  return { x: constrainedX, y: constrainedY }
}

export function getDefaultPosition(): Position {
  if (typeof window === 'undefined') return defaultPosition

  const defaultX = window.innerWidth - 320 - 16
  const defaultY = window.innerHeight - 300 - 80

  return { x: Math.max(0, defaultX), y: Math.max(0, defaultY) }
}
