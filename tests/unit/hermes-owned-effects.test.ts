import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Effect, Exit, Fiber } from 'effect'
import { modelOwner } from 'effectweb'
import { speakHermesText } from '@/features/hermes/hermes-reply-audio'
import { patchHermesState } from '@/features/hermes/hermes-session-registry'
import { HermesSessions } from '@/features/hermes/hermes-session-store'

const originalAudio = globalThis.Audio
const restorers: (() => void)[] = []
afterEach(() => {
  for (const restore of restorers.splice(0)) restore()
  globalThis.Audio = originalAudio
})
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
function defer<A>() {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function mockFetch(run: (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>) {
  const mock = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(run, { preconnect: globalThis.fetch.preconnect }),
  )
  restorers.push(() => mock.mockRestore())
  return mock
}
class ReplyAudio {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  listeners = new Map<string, () => void>()
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback)
  }
  removeEventListener(name: string) {
    this.listeners.delete(name)
  }
  end() {
    this.onended?.()
  }
  static instances: ReplyAudio[] = []
  error: MediaError | null = null
  paused = true
  removed = false
  loaded = false
  constructor(readonly src: string) {
    ReplyAudio.instances.push(this)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  removeAttribute(name: string) {
    if (name === 'src') this.removed = true
  }
  load() {
    this.loaded = true
  }
}
function installAudio() {
  ReplyAudio.instances = []
  globalThis.Audio = ReplyAudio as unknown as typeof Audio
}

describe('owned Hermes reply audio', () => {
  test('replacing a pending spoken reply aborts it and disposal releases the current audio', async () => {
    installAudio()
    const first = defer<Response>()
    let firstSignal: AbortSignal | undefined
    mockFetch((_input, options) => {
      const body = JSON.parse(typeof options?.body === 'string' ? options.body : '{}') as {
        text: string
      }
      if (body.text === 'first') {
        firstSignal = options?.signal ?? undefined
        return first.promise
      }
      return Promise.resolve(Response.json({ data_url: 'data:audio/new' }))
    })
    const owner = modelOwner({})
    const slot = 'test-reply'
    owner.run(slot, speakHermesText('first'), 'replace')
    await turn()
    owner.run(slot, speakHermesText('second'), 'replace')
    await turn()
    expect(firstSignal?.aborted).toBe(true)
    first.resolve(Response.json({ data_url: 'data:audio/old' }))
    await turn()
    expect(ReplyAudio.instances.map((audio) => audio.src)).toEqual(['data:audio/new'])
    expect(ReplyAudio.instances[0]?.paused).toBe(false)
    await Effect.runPromise(owner.close())
    expect(ReplyAudio.instances[0]?.paused).toBe(true)
    expect(ReplyAudio.instances[0]?.removed).toBe(true)
    expect(ReplyAudio.instances[0]?.loaded).toBe(true)
  })

  test('reply completion releases audio and rejects malformed server responses before allocation', async () => {
    installAudio()
    const fetch = mockFetch(() => Promise.resolve(Response.json({ data_url: 'data:audio/reply' })))
    const fiber = Effect.runFork(speakHermesText('reply'))
    await turn()
    ReplyAudio.instances[0]!.end()
    await Effect.runPromise(Fiber.join(fiber))
    expect(ReplyAudio.instances[0]?.paused).toBe(true)
    expect(ReplyAudio.instances[0]?.removed).toBe(true)
    fetch.mockImplementation(
      Object.assign(() => Promise.resolve(Response.json({ data_url: 123 })), {
        preconnect: globalThis.fetch.preconnect,
      }),
    )
    const exit = await Effect.runPromiseExit(speakHermesText('invalid'))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(ReplyAudio.instances).toHaveLength(1)
  })
})

describe('Hermes session request ordering', () => {
  test('session commands remain lazy until their caller runs the Effect', async () => {
    let requests = 0
    mockFetch((input) => {
      if ((input instanceof Request ? input.url : input.toString()) === '/api/hermes/turn')
        requests++
      return Promise.resolve(Response.json({ sessionId: `lazy-${crypto.randomUUID()}` }))
    })
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    session.composer.setDraft('lazy turn')
    const send = session.prompt.send()
    expect(Effect.isEffect(send)).toBe(true)
    expect(session.state()?.composer).toBe('lazy turn')
    expect(requests).toBe(0)
    await Effect.runPromise(send)
    expect(requests).toBe(1)
    expect(session.state()?.composer).toBe('')
  })

  test('sending publishes the optimistic message, cleared draft and awaiting state together before HTTP completes', async () => {
    const gate = defer<Response>()
    mockFetch((input) =>
      (input instanceof Request ? input.url : input.toString()) === '/api/hermes/turn'
        ? gate.promise
        : Promise.resolve(Response.json({})),
    )
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    session.composer.setDraft('pending turn')
    const sending = Effect.runPromise(session.prompt.send())
    await turn()
    expect(session.state()?.composer).toBe('')
    expect(session.state()?.awaitingResponse).toBe(true)
    expect(session.state()?.status).toBe('sending')
    expect(session.state()?.messages.at(-1)?.text).toBe('pending turn')
    gate.resolve(Response.json({ sessionId: `sent-${crypto.randomUUID()}` }))
    await sending
  })

  test('an accepted HTTP turn cannot reopen a turn already completed by the event stream', async () => {
    const gate = defer<Response>()
    mockFetch((input) =>
      (input instanceof Request ? input.url : input.toString()) === '/api/hermes/turn'
        ? gate.promise
        : Promise.resolve(Response.json({})),
    )
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    session.composer.setDraft('quick turn')
    const sending = Effect.runPromise(session.prompt.send())
    await turn()
    patchHermesState(session.key(), {
      status: 'idle',
      awaitingResponse: false,
      streamMessageId: undefined,
    })
    gate.resolve(Response.json({ sessionId: `completed-${crypto.randomUUID()}` }))
    await sending
    expect(session.state()?.status).toBe('idle')
    expect(session.state()?.awaitingResponse).toBe(false)
  })

  test('an idle history response cannot erase a newly sent optimistic turn', async () => {
    const history = defer<Response>()
    const sessionId = `history-${crypto.randomUUID()}`
    mockFetch((input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/messages?')) return history.promise
      if (url === '/api/hermes/turn') return Promise.resolve(Response.json({ sessionId }))
      return Promise.resolve(Response.json({}))
    })
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    session.identity.bind(sessionId)
    const refreshing = Effect.runPromise(session.history.refresh())
    await turn()
    session.composer.setDraft('new turn')
    await Effect.runPromise(session.prompt.send())
    history.resolve(
      Response.json({ messages: [{ id: 'old', role: 'assistant', text: 'old history' }] }),
    )
    await refreshing
    expect(session.state()?.messages.map((message) => message.text)).toEqual(['new turn'])
    expect(session.state()?.status).toBe('streaming')
  })

  test('a stale failed history request cannot mark a rotated durable session unavailable', async () => {
    const history = defer<Response>()
    mockFetch((input) =>
      (input instanceof Request ? input.url : input.toString()).includes('/messages?')
        ? history.promise
        : Promise.resolve(Response.json({})),
    )
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    session.identity.bind(`old-${crypto.randomUUID()}`)
    const refreshing = Effect.runPromise(session.history.refresh())
    await turn()
    const next = `new-${crypto.randomUUID()}`
    session.identity.bind(next)
    history.resolve(Response.json({ error: 'old session missing' }, { status: 404 }))
    await refreshing
    expect(session.state()?.sessionId).toBe(next)
    expect(session.state()?.unavailable).not.toBe(true)
    expect(session.state()?.status).toBe('idle')
  })

  test('completions replace their request and composer changes preserve untouched immutable arrays', async () => {
    const requests: AbortSignal[] = []
    const pending = defer<Response>()
    mockFetch((input, options) => {
      if ((input instanceof Request ? input.url : input.toString()).includes('/completions?')) {
        requests.push(options!.signal!)
        return pending.promise
      }
      return Promise.resolve(Response.json({}))
    })
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    const before = session.state()!
    session.composer.setDraft('/a')
    await turn()
    session.composer.setDraft('/ab')
    await turn()
    expect(requests).toHaveLength(2)
    expect(requests[0]?.aborted).toBe(true)
    expect(requests[1]?.aborted).toBe(false)
    expect(session.state()?.messages).toBe(before.messages)
    expect(session.state()?.attachments).toBe(before.attachments)
    pending.resolve(Response.json({ items: [] }))
    await turn()
  })

  test('a malformed turn response restores the draft without binding an invalid durable id', async () => {
    mockFetch(() => Promise.resolve(Response.json({})))
    const session = HermesSessions.open({ draftId: crypto.randomUUID() })
    session.composer.setDraft('preserved')
    const failed = await Effect.runPromise(session.prompt.send()).then(
      () => false,
      () => true,
    )
    expect(failed).toBe(true)
    expect(session.state()?.sessionId).toBeUndefined()
    expect(session.state()?.composer).toBe('preserved')
    expect(session.state()?.messages).toEqual([])
    expect(session.state()?.status).toBe('error')
  })
})
