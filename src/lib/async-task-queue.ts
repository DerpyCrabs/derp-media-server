export type KeyedAsyncTaskQueue<Key> = {
  run<T>(key: Key, task: () => Promise<T>): Promise<T>
  isBusy(key: Key): boolean
}

/** Serializes work per key while allowing different keys to run concurrently. */
export function createKeyedAsyncTaskQueue<Key>(): KeyedAsyncTaskQueue<Key> {
  const tails = new Map<Key, Promise<void>>()

  return {
    run<T>(key: Key, task: () => Promise<T>) {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(task)
      const tail = result.then(
        () => undefined,
        () => undefined,
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return result
    },
    isBusy(key: Key) {
      return tails.has(key)
    },
  }
}
