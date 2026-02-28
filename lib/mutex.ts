/**
 * Simple async mutex to prevent race conditions on shared resources.
 * Module-level instances persist for the lifetime of the server process.
 */
export class Mutex {
  private queue: Array<() => void> = []
  private locked = false

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true
          resolve(() => {
            if (this.queue.length > 0) {
              const next = this.queue.shift()!
              next()
            } else {
              this.locked = false
            }
          })
        } else {
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }
}
