import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { createAppDialogs } from '../../src/lib/ui/app-dialog'

test('choice validates identity and keeps queued confirmations boolean', async () => {
  const dialogs = createAppDialogs()
  try {
    const choice = Effect.runPromise(
      dialogs.choose('Open with', 'document.txt', [{ id: 'editor.desktop', label: 'Editor' }]),
    )
    const confirmation = Effect.runPromise(
      dialogs.confirm({ title: 'Delete', message: 'Remove file?' }),
    )
    expect(dialogs.read()?.kind).toBe('choose')
    dialogs.settle('unlisted.desktop')
    dialogs.settle(true)
    expect(dialogs.read()?.kind).toBe('choose')
    dialogs.settle('editor.desktop')
    expect(await choice).toBe('editor.desktop')
    expect(dialogs.read()?.kind).toBe('confirm')
    dialogs.settle('editor.desktop')
    expect(dialogs.read()?.kind).toBe('confirm')
    dialogs.settle(true)
    expect(await confirmation).toBe(true)
    expect(dialogs.read()).toBeNull()
  } finally {
    dialogs.dispose()
  }
})

test('closing the dialog owner cancels choices and confirmations', async () => {
  const dialogs = createAppDialogs()
  const choice = Effect.runPromise(
    dialogs.choose('Open with', 'document.txt', [{ id: 'editor.desktop', label: 'Editor' }]),
  )
  const confirmation = Effect.runPromise(
    dialogs.confirm({ title: 'Delete', message: 'Remove file?' }),
  )
  dialogs.dispose()
  expect(await choice).toBeNull()
  expect(await confirmation).toBe(false)
})
