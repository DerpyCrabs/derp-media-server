import { describe, expect, test } from 'bun:test'

import { createKeyedAsyncTaskQueue } from '@/lib/async-task-queue'

describe('createKeyedAsyncTaskQueue', () => {
  test('runs tasks for one key in submission order', async () => {
    const queue = createKeyedAsyncTaskQueue<string>()
    const events: string[] = []
    let releaseFirst: (() => void) | undefined

    const first = queue.run('same', async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      events.push('first:end')
      return 'first'
    })
    const second = queue.run('same', async () => {
      events.push('second:start')
      return 'second'
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst?.()
    expect(await Promise.all([first, second])).toEqual(['first', 'second'])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  test('runs different keys concurrently', async () => {
    const queue = createKeyedAsyncTaskQueue<string>()
    const events: string[] = []
    let releaseA: (() => void) | undefined

    const a = queue.run('a', async () => {
      events.push('a:start')
      await new Promise<void>((resolve) => {
        releaseA = resolve
      })
      events.push('a:end')
    })
    const b = queue.run('b', async () => {
      events.push('b:start')
    })

    await Promise.resolve()
    expect(events).toEqual(['a:start', 'b:start'])
    await b
    releaseA?.()
    await a
  })

  test('continues one key after a rejected task', async () => {
    const queue = createKeyedAsyncTaskQueue<string>()

    const failed = queue.run('same', async () => {
      throw new Error('failed')
    })
    const recovered = queue.run('same', async () => 'recovered')

    expect(failed).rejects.toThrow('failed')
    expect(await recovered).toBe('recovered')
  })

  test('removes a key after its final task settles', async () => {
    const queue = createKeyedAsyncTaskQueue<string>()

    const task = queue.run('idle', async () => 'done')
    expect(queue.isBusy('idle')).toBe(true)
    await task
    await Promise.resolve()
    expect(queue.isBusy('idle')).toBe(false)
  })
})
