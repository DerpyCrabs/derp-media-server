export type ThumbnailLoadTicket = {
  cancel: () => void
  release: () => void
}

type QueueItem = {
  start: () => void
  active: boolean
  cancelled: boolean
}

const DEFAULT_CONCURRENCY = 4

class ThumbnailLoadQueue {
  private activeCount = 0
  private readonly pending: QueueItem[] = []

  constructor(private readonly concurrency = DEFAULT_CONCURRENCY) {}

  enqueue(start: () => void): ThumbnailLoadTicket {
    const item: QueueItem = {
      start,
      active: false,
      cancelled: false,
    }

    const release = () => {
      if (!item.active) return
      item.active = false
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.drain()
    }

    const cancel = () => {
      if (item.cancelled) return
      item.cancelled = true
      if (item.active) {
        release()
        return
      }
      const index = this.pending.indexOf(item)
      if (index !== -1) this.pending.splice(index, 1)
    }

    this.pending.push(item)
    this.drain()

    return { cancel, release }
  }

  private drain() {
    while (this.activeCount < this.concurrency) {
      const item = this.pending.shift()
      if (!item) return
      if (item.cancelled) continue

      item.active = true
      this.activeCount += 1
      item.start()
    }
  }
}

export const thumbnailLoadQueue = new ThumbnailLoadQueue()
