import { describe, expect, test } from 'bun:test'
import { appDialogRequest, settleAppDialog } from '@/lib/ui/app-dialog'
import { HermesSessions } from '@/features/hermes/hermes-session-store'

function pendingTakeover() {
  const session = HermesSessions.open({
    draftId: `ownership-${crypto.randomUUID()}`,
  })
  session.state()!.editorOwner = 'existing-owner'
  session.composer.set('unsaved text')
  return session
}

describe('Hermes editor ownership', () => {
  test('assigns a confirmed takeover when the observed owner is unchanged', async () => {
    const session = pendingTakeover()
    const claim = session.editor.claim('new-owner')

    expect(appDialogRequest()?.title).toBe('Take editing control?')
    settleAppDialog(true)

    expect(await claim).toBe(true)
    expect(session.state()?.editorOwner).toBe('new-owner')
  })

  test('does not assign owner after its lifetime ends while confirmation is open', async () => {
    const session = pendingTakeover()
    let alive = true
    const claim = session.editor.claim('stale-owner', { isAlive: () => alive })

    expect(appDialogRequest()?.title).toBe('Take editing control?')
    alive = false
    settleAppDialog(true)

    expect(await claim).toBe(false)
    expect(session.state()?.editorOwner).toBe('existing-owner')
  })

  test('rechecks current owner after confirmation before assigning', async () => {
    const session = pendingTakeover()
    const claim = session.editor.claim('new-owner')

    session.state()!.editorOwner = 'other-owner'
    settleAppDialog(true)

    expect(await claim).toBe(false)
    expect(session.state()?.editorOwner).toBe('other-owner')
  })

  test('release invalidates a pending claim for same owner', async () => {
    const session = pendingTakeover()
    const claim = session.editor.claim('stale-owner')

    session.editor.release('stale-owner')
    settleAppDialog(true)

    expect(await claim).toBe(false)
    expect(session.state()?.editorOwner).toBe('existing-owner')
  })
})

test('an editor lease uses the tracked key for both claim and release', async () => {
  const suffix = crypto.randomUUID()
  const firstSession = HermesSessions.open({ draftId: `lease-a-${suffix}` })
  const nextSession = HermesSessions.open({ draftId: `lease-b-${suffix}` })
  const trackedKey = firstSession.key()
  const firstState = firstSession.state()!
  const secondState = nextSession.state()!
  const lease = nextSession.editor.acquire(trackedKey, 'lease-owner')

  expect(await lease.claim()).toBe(true)
  expect(firstState.editorOwner).toBe('lease-owner')
  expect(secondState.editorOwner).toBeUndefined()
  secondState.editorOwner = 'lease-owner'
  lease.release()
  expect(firstState.editorOwner).toBeUndefined()
  expect(secondState.editorOwner).toBe('lease-owner')
})
