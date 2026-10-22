import { Semaphore } from 'effect'

export const thumbnailLoadQueue = Semaphore.makeUnsafe(4)
