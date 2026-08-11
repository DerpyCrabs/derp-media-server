import { describe, expect, test } from 'bun:test'
import { createPhysicalOfflinePathCoordinator } from '@/src/lib/physical-offline-paths'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
}

describe('physical offline path coordinator Interface', () => {
  test('serializes owner and Grant work for one legacy physical path through cleanup', async () => {
    const coordinator = createPhysicalOfflinePathCoordinator()
    const ownerStarted = deferred()
    const ownerCleanup = deferred()
    const grantStarted = deferred()
    let active = 0
    let maximumActive = 0

    const owner = coordinator.schedule('SharedContent/public-doc.txt', async (signal) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      ownerStarted.resolve()
      try {
        await aborted(signal)
      } finally {
        await ownerCleanup.promise
        active -= 1
      }
    })
    void owner.completion.catch(() => undefined)
    await ownerStarted.promise

    const grant = coordinator.schedule('SharedContent/public-doc.txt', async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      grantStarted.resolve()
      active -= 1
    })

    await Promise.resolve()
    expect(owner.isCurrent()).toBe(false)
    expect(grant.isCurrent()).toBe(true)
    expect(maximumActive).toBe(1)

    ownerCleanup.resolve()
    await grantStarted.promise
    await grant.completion
    expect(maximumActive).toBe(1)
  })

  test('does not serialize distinct legacy physical paths', async () => {
    const coordinator = createPhysicalOfflinePathCoordinator()
    const release = deferred()
    let active = 0
    let maximumActive = 0
    const work = async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await release.promise
      active -= 1
    }

    const first = coordinator.schedule('Music/a.mp3', work)
    const second = coordinator.schedule('Music/b.mp3', work)
    await Promise.resolve()
    expect(maximumActive).toBe(2)

    release.resolve()
    await Promise.all([first.completion, second.completion])
  })

  test('serializes ancestor and descendant paths in both scheduling orders', async () => {
    for (const [firstPath, secondPath] of [
      ['Documents', 'Documents/readme.txt'],
      ['Documents/readme.txt', 'Documents'],
    ]) {
      const coordinator = createPhysicalOfflinePathCoordinator()
      const firstStarted = deferred()
      const releaseFirst = deferred()
      let active = 0
      let maximumActive = 0

      const first = coordinator.schedule(firstPath, async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        firstStarted.resolve()
        await releaseFirst.promise
        active -= 1
      })
      await firstStarted.promise
      const second = coordinator.schedule(secondPath, async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        active -= 1
      })

      await Promise.resolve()
      expect(maximumActive).toBe(1)
      releaseFirst.resolve()
      await Promise.all([first.completion, second.completion])
      expect(maximumActive).toBe(1)
    }
  })

  test('retains an ancestor cleanup barrier across child and sibling schedules', async () => {
    const coordinator = createPhysicalOfflinePathCoordinator()
    const directoryStarted = deferred()
    const directoryCleanup = deferred()
    let siblingStarted = false

    const directory = coordinator.schedule('Documents', async (signal) => {
      directoryStarted.resolve()
      try {
        await aborted(signal)
      } finally {
        await directoryCleanup.promise
      }
    })
    void directory.completion.catch(() => undefined)
    await directoryStarted.promise

    const child = coordinator.schedule('Documents/a.txt', async () => undefined)
    const sibling = coordinator.schedule('Documents/b.txt', async () => {
      siblingStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(siblingStarted).toBe(false)

    directoryCleanup.resolve()
    await Promise.all([child.completion, sibling.completion])
    expect(siblingStarted).toBe(true)
  })
})
