import { Effect } from 'effect'
import { expect, test } from 'bun:test'
import { createPicker } from '@/desktop/picker-controller'
import type { DesktopBridge, PickerRequest } from '@/desktop/bridge'

function request(name: string): PickerRequest {
  return {
    mode: 'SaveFile',
    directory: false,
    multiple: false,
    name,
    acceptLabel: 'Save',
    filters: [],
    filter: 0,
    choices: [],
  }
}

test('a late picker rejection cannot change the replacement request', async () => {
  let reject!: (error: Error) => void
  let current = request('first.txt')
  const bridge = {
    pick: () =>
      new Promise((_resolve, rejectResult) => {
        reject = rejectResult
      }),
  } as unknown as DesktopBridge
  const picker = createPicker({
    request: () => current,
    directory: () => '',
    navigate: () => {},
    bridge,
  })
  picker.receive()
  picker.accept()
  current = request('second.txt')
  picker.receive()
  reject(new Error('first request failed'))
  await Effect.runPromise(picker.awaitIdle())
  expect(picker.source.model()).toMatchObject({ name: 'second.txt', pending: false, error: '' })
  picker.dispose()
})

test('a picker completion after disposal cannot open overwrite confirmation', async () => {
  let resolve!: (result: { overwrite: string[] }) => void
  const current = request('first.txt')
  const bridge = {
    pick: () =>
      new Promise((resolveResult) => {
        resolve = resolveResult
      }),
  } as unknown as DesktopBridge
  const picker = createPicker({
    request: () => current,
    directory: () => '',
    navigate: () => {},
    bridge,
  })
  picker.receive()
  picker.accept()
  picker.dispose()
  resolve({ overwrite: ['first.txt'] })
  await Effect.runPromise(picker.awaitIdle())
})

test('replacing a picker request cancels its visible overwrite confirmation', async () => {
  const { appDialogRequest } = await import('@/lib/ui/app-dialog')
  let current = request('first.txt')
  const bridge = { pick: async () => ({ overwrite: ['first.txt'] }) } as unknown as DesktopBridge
  const picker = createPicker({
    request: () => current,
    directory: () => '',
    navigate: () => {},
    bridge,
  })
  picker.receive()
  picker.accept()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(appDialogRequest()?.title).toBe('Replace file?')
  current = request('second.txt')
  picker.receive()
  await Effect.runPromise(picker.awaitIdle())
  expect(appDialogRequest()).toBeNull()
  expect(picker.source.model()).toMatchObject({ name: 'second.txt', pending: false })
  picker.dispose()
})

test('picker reports the desktop bridge failure message', async () => {
  const bridge = {
    pick: async () => {
      throw new Error('Permission denied: first.txt')
    },
  } as unknown as DesktopBridge
  const current = request('first.txt')
  const picker = createPicker({
    request: () => current,
    directory: () => '',
    navigate: () => {},
    bridge,
  })
  picker.receive()
  picker.accept()
  await Effect.runPromise(picker.awaitIdle())
  expect(picker.source.model().error).toBe('Permission denied: first.txt')
  picker.dispose()
})
