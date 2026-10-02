import { afterEach, expect, test } from 'bun:test'
import { Effect, Fiber } from 'effect'
import { parseBook } from '@/features/reader/contentTypes/book/book-parser'

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
afterEach(() => {
  if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
  else Reflect.deleteProperty(globalThis, 'Worker')
})

test('book parsing starts lazily and interruption terminates its worker', async () => {
  const workers: TestWorker[] = []
  class TestWorker {
    onmessage: unknown = null
    onerror: unknown = null
    terminated = false
    constructor() {
      workers.push(this)
    }
    postMessage() {}
    terminate() {
      this.terminated = true
    }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: TestWorker })
  const parsing = parseBook(new ArrayBuffer(8), 'book.epub')
  expect(workers).toHaveLength(0)
  const fiber = Effect.runFork(parsing)
  expect(workers).toHaveLength(1)
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(workers[0]?.terminated).toBe(true)
  expect(workers[0]?.onmessage).toBeNull()
  expect(workers[0]?.onerror).toBeNull()
})
