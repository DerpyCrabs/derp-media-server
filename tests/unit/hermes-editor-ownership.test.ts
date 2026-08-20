import { describe, expect, test } from 'bun:test'
import { appDialogRequest, settleAppDialog } from '@/lib/ui/app-dialog'
import {
  claimHermesEditor,
  ensureHermesChat,
  hermesSessions,
  releaseHermesEditor,
} from '@/features/hermes/hermes-session-store'

function pendingTakeover() {
  const key = ensureHermesChat({ draftId: `ownership-${crypto.randomUUID()}` })
  hermesSessions[key]!.editorOwner = 'existing-owner'
  hermesSessions[key]!.composer = 'unsaved text'
  return key
}

describe('Hermes editor ownership', () => {
  test('assigns a confirmed takeover when the observed owner is unchanged', async () => {
    const key = pendingTakeover()
    const claim = claimHermesEditor(key, 'new-owner')

    expect(appDialogRequest()?.title).toBe('Take editing control?')
    settleAppDialog(true)

    expect(await claim).toBe(true)
    expect(hermesSessions[key]?.editorOwner).toBe('new-owner')
  })

  test('does not assign owner after its lifetime ends while confirmation is open', async () => {
    const key = pendingTakeover()
    let alive = true
    const claim = claimHermesEditor(key, 'stale-owner', { isAlive: () => alive })

    expect(appDialogRequest()?.title).toBe('Take editing control?')
    alive = false
    settleAppDialog(true)

    expect(await claim).toBe(false)
    expect(hermesSessions[key]?.editorOwner).toBe('existing-owner')
  })

  test('rechecks current owner after confirmation before assigning', async () => {
    const key = pendingTakeover()
    const claim = claimHermesEditor(key, 'new-owner')

    hermesSessions[key]!.editorOwner = 'other-owner'
    settleAppDialog(true)

    expect(await claim).toBe(false)
    expect(hermesSessions[key]?.editorOwner).toBe('other-owner')
  })

  test('release invalidates a pending claim for same owner', async () => {
    const key = pendingTakeover()
    const claim = claimHermesEditor(key, 'stale-owner')

    releaseHermesEditor(key, 'stale-owner')
    settleAppDialog(true)

    expect(await claim).toBe(false)
    expect(hermesSessions[key]?.editorOwner).toBe('existing-owner')
  })
})
