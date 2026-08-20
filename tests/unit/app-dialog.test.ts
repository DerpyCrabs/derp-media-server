import { describe, expect, test } from 'bun:test'
import { appDialogRequest, settleAppDialog, showAppConfirm } from '@/lib/ui/app-dialog'

describe('app dialog queue', () => {
  test('keeps a dialog enqueued by the previous dialog continuation active', async () => {
    const first = showAppConfirm({ title: 'First', message: 'First message' })
    let second: Promise<boolean> | undefined
    const continuation = first.then(() => {
      second = showAppConfirm({ title: 'Second', message: 'Second message' })
    })

    settleAppDialog(true)
    await continuation
    await Promise.resolve()

    expect(appDialogRequest()?.title).toBe('Second')
    settleAppDialog(false)
    expect(await second!).toBe(false)
  })
})
