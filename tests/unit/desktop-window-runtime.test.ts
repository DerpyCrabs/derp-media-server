import { expect, test } from 'bun:test'
import { Window as TestWindow } from 'happy-dom'
import { Effect } from 'effect'
import { acquireWindowHistory } from '@/lib/browser/window-history'
import { acquireDesktopOperations } from '@/desktop/operations'
import { flushDesktopClose, registerDesktopCloseHandler } from '@/desktop/close-handlers'
import type { DesktopBridge } from '@/desktop/bridge'
import { createOverlay } from '@effectweb/base-ui'
import { acquireModalFocus } from '@/lib/ui/modal-focus'
import { restoreOverlayFocus } from '@/lib/ui/overlay-focus'
import { modalScroll } from '@/features/viewer/modal-scroll'
import {
  acquireWindowBreadcrumbs,
  breadcrumbFloatingForWindow,
} from '@/features/explorer/breadcrumb-floating-store'

function browserWindow(path = '/desktop?dir=first#anchor') {
  return new TestWindow({ url: `https://aluminos.test${path}` }) as unknown as Window
}

test('breadcrumb menus retain independent window lifetimes', () => {
  const first = browserWindow(),
    second = browserWindow()
  const a = acquireWindowBreadcrumbs(first),
    b = acquireWindowBreadcrumbs(second)
  const left = breadcrumbFloatingForWindow(first.document.defaultView!)
  const right = breadcrumbFloatingForWindow(second.document.defaultView!)
  left.setBreadcrumbCompactPathOpen(true)
  expect(right.breadcrumbFloating.read().compactPathOpen).toBe(false)
  a.dispose()
  expect(() => breadcrumbFloatingForWindow(first)).toThrow('not mounted')
  right.setBreadcrumbCompactPathOpen(true)
  expect(right.breadcrumbFloating.read().compactPathOpen).toBe(true)
  b.dispose()
})

test('runtime rejects internal Window identities before acquiring window resources', async () => {
  const { createSurfaceRuntime } = await import('@/desktop/surface-runtime')
  const target = browserWindow()
  let mounted = false
  const runtime = createSurfaceRuntime(target.location.origin, async () => {
    mounted = true
    return async () => {}
  })
  const internal = { document: target.document, location: target.location } as Window
  expect(await runtime.mount(internal).then(() => null, String)).toContain('WindowProxy')
  expect(mounted).toBe(false)
  await runtime.mount(target)
  expect(mounted).toBe(true)
  await runtime.close()
})

test('windows sharing a runtime navigate independently and retain their fragment', async () => {
  const first = browserWindow(),
    second = browserWindow('/desktop?dir=second')
  const a = acquireWindowHistory(first),
    b = acquireWindowHistory(second)
  try {
    a.navigate({ dir: 'pictures', viewing: 'pictures/photo.jpg' }, 'push')
    expect(a.source.model().search).toBe('?dir=pictures&viewing=pictures%2Fphoto.jpg')
    expect(b.source.model().search).toBe('?dir=second')
    expect(first.location.hash).toBe('#anchor')
    second.history.pushState(null, '', '/desktop?dir=third')
    expect(b.source.model().search).toBe('?dir=third')
    expect(a.source.model().search).toContain('pictures')
    second.history.back()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(b.source.model().search).toBe('?dir=second')
  } finally {
    a.dispose()
    b.dispose()
  }
})

test('history subscriptions share one owner and released callers cannot navigate', () => {
  const target = browserWindow()
  // eslint-disable-next-line typescript/unbound-method
  const original = target.history.pushState
  const a = acquireWindowHistory(target),
    b = acquireWindowHistory(target)
  expect(a.source).toBe(b.source)
  a.dispose()
  a.navigate({ dir: 'retired' }, 'push')
  expect(b.source.model().search).toBe('?dir=first')
  b.navigate({ dir: 'live' }, 'replace')
  expect(b.source.model().search).toBe('?dir=live')
  b.dispose()
  // eslint-disable-next-line typescript/unbound-method
  expect(target.history.pushState).toBe(original)
  const reopened = acquireWindowHistory(target)
  a.dispose()
  reopened.navigate({ dir: 'reopened' }, 'push')
  expect(reopened.source.model().search).toBe('?dir=reopened')
  reopened.dispose()
  // eslint-disable-next-line typescript/unbound-method
  expect(target.history.pushState).toBe(original)
})

test('close flushes only the requesting window and an old unsubscribe cannot remove new handlers', async () => {
  const first = browserWindow(),
    second = browserWindow()
  first.derpDesktop = {} as DesktopBridge
  second.derpDesktop = {} as DesktopBridge
  const calls: string[] = []
  const a = registerDesktopCloseHandler(
    () =>
      Effect.sync(() => {
        calls.push('first')
      }),
    first,
  )!
  const b = registerDesktopCloseHandler(
    () =>
      Effect.sync(() => {
        calls.push('second')
      }),
    second,
  )!
  await Effect.runPromise(flushDesktopClose(first))
  expect(calls).toEqual(['first'])
  a()
  const replacement = registerDesktopCloseHandler(
    () =>
      Effect.sync(() => {
        calls.push('replacement')
      }),
    first,
  )!
  a()
  await Effect.runPromise(flushDesktopClose(first))
  await Effect.runPromise(flushDesktopClose(second))
  expect(calls).toEqual(['first', 'replacement', 'second'])
  replacement()
  b()
})

test('operations publish to their window, retain pending across overlap and suppress retired completion', async () => {
  const first = browserWindow(),
    second = browserWindow()
  const a = acquireDesktopOperations(first),
    b = acquireDesktopOperations(second)
  const events: { pending: boolean; error?: string }[] = []
  const other: unknown[] = []
  first.addEventListener('desktop-operation', (event) => events.push((event as CustomEvent).detail))
  second.addEventListener('desktop-operation', (event) => other.push((event as CustomEvent).detail))
  let finish!: () => void
  let reject!: (error: Error) => void
  a.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  a.run(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail
      }),
  )
  finish()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(events.at(-1)?.pending).toBe(true)
  expect(other).toEqual([])
  reject(new Error('failure belongs to first'))
  await Effect.runPromise(a.awaitIdle())
  expect(events.at(-1)).toEqual({ pending: false, error: 'failure belongs to first' })
  a.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  a.dispose()
  const count = events.length
  finish()
  await Effect.runPromise(a.awaitIdle())
  expect(events).toHaveLength(count)
  b.run(async () => {})
  await Effect.runPromise(b.awaitIdle())
  expect(other).toEqual([{ pending: true }, { pending: false }])
  b.dispose()
})

test('modal focus and scroll belong to the element document, without an ambient document', async () => {
  const first = browserWindow(),
    second = browserWindow()
  const trigger = first.document.createElement('button')
  const sibling = second.document.createElement('button')
  const modal = first.document.createElement('div')
  const input = first.document.createElement('input')
  first.document.body.append(trigger, modal)
  second.document.body.append(sibling)
  modal.append(input)
  trigger.focus()
  sibling.focus()
  const release = acquireModalFocus(modal, () => ({ onEscape() {} }))
  const scroll = modalScroll(modal, () => true)
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
  expect(first.document.activeElement).toBe(input)
  expect(second.document.activeElement).toBe(sibling)
  expect(first.document.body.style.overflow).toBe('hidden')
  expect(second.document.body.style.overflow).toBe('')
  release()
  scroll.dispose()
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
  expect(first.document.activeElement).toBe(trigger)
  expect(second.document.activeElement).toBe(sibling)
  expect(first.document.body.style.overflow).toBe('')
})

test('overlay focus restoration does not depend on the runtime host document', () => {
  const target = browserWindow()
  const trigger = target.document.createElement('button')
  const popup = target.document.createElement('div')
  const input = target.document.createElement('input')
  const handle = createOverlay()
  handle.attachTrigger(trigger)
  popup.id = `${handle.id}-popup`
  target.document.body.append(trigger, popup)
  popup.append(input)
  input.focus()
  restoreOverlayFocus(handle)
  expect(target.document.activeElement).toBe(trigger)
  const unrelated = target.document.createElement('input')
  target.document.body.append(unrelated)
  unrelated.focus()
  restoreOverlayFocus(handle)
  expect(target.document.activeElement).toBe(unrelated)
  handle.lifetime.dispose()
})

test('floating menus dismiss only inside their owning document', async () => {
  const { registerFloatingDismissLayer, floatingPointerInsideSurface } =
    await import('@/lib/ui/floating-layer-registry')
  const first = browserWindow(),
    second = browserWindow()
  let a = 0,
    b = 0
  const menu = first.document.createElement('div')
  first.document.body.append(menu)
  const stopA = registerFloatingDismissLayer(
    {
      zIndex: 1,
      isInside: (event) => floatingPointerInsideSurface(event, menu, [], undefined, undefined),
      dismiss: () => {
        a++
      },
    },
    first.document,
  )
  const stopB = registerFloatingDismissLayer(
    {
      zIndex: 100,
      isInside: () => false,
      dismiss: () => {
        b++
      },
    },
    second.document,
  )
  try {
    const inside = first.document.createEvent('Event')
    inside.initEvent('pointerdown', true, true)
    menu.dispatchEvent(inside)
    expect([a, b]).toEqual([0, 0])
    const outside = first.document.createEvent('Event')
    outside.initEvent('pointerdown', true, true)
    first.document.body.dispatchEvent(outside)
    expect([a, b]).toEqual([1, 0])
    second.dispatchEvent(new Event('resize'))
    expect(b).toBe(0)
    const escape = second.document.createEvent('Event')
    escape.initEvent('keydown', true, true)
    Object.defineProperty(escape, 'key', { value: 'Escape' })
    second.document.body.dispatchEvent(escape)
    expect([a, b]).toEqual([1, 1])
  } finally {
    stopA()
    stopB()
  }
})

test('dialogs belong to their window and retiring one settles only its prompts', async () => {
  const { acquireWindowDialogs, dialogsForWindow } = await import('@/lib/ui/app-dialog')
  const first = browserWindow(),
    second = browserWindow()
  const a = acquireWindowDialogs(first),
    b = acquireWindowDialogs(second)
  const question = { title: 'Close', message: 'Save changes?' }
  const answerA = Effect.runPromise(a.dialogs.confirm(question))
  const answerB = Effect.runPromise(b.dialogs.confirm(question))
  await Promise.resolve()
  expect(dialogsForWindow(first)).toBe(a.dialogs)
  a.dispose()
  expect(await answerA).toBe(false)
  expect(b.dialogs.read()?.title).toBe('Close')
  b.dialogs.settle(true)
  expect(await answerB).toBe(true)
  b.dispose()
  expect(() => dialogsForWindow(first)).toThrow('not mounted')
})

test('shared runtime mounts once per window and awaits teardown without blocking siblings', async () => {
  const { createSurfaceRuntime } = await import('@/desktop/surface-runtime')
  const first = browserWindow(),
    second = browserWindow()
  const opened: Window[] = [],
    disposed: Window[] = []
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const runtime = createSurfaceRuntime(first.location.origin, async (target) => {
    opened.push(target)
    return async () => {
      if (target === first) await barrier
      disposed.push(target)
    }
  })
  expect(runtime.mount(first)).toBe(runtime.mount(first))
  await runtime.mount(second)
  const closing = runtime.unmount(first)
  expect(runtime.unmount(first)).toBe(closing)
  await runtime.unmount(second)
  expect(opened).toEqual([first, second])
  expect(disposed).toEqual([second])
  release()
  await closing
  expect(disposed).toEqual([second, first])
  expect(await runtime.mount(first).then(() => null, String)).toContain('Retired')
  await runtime.close()
})

test('closing a surface interrupts setup and forbids a foreign document', async () => {
  const { createSurfaceRuntime } = await import('@/desktop/surface-runtime')
  const first = browserWindow()
  let cancelled = false
  const runtime = createSurfaceRuntime(first.location.origin, async (_target, signal) => {
    await new Promise<void>((_resolve, reject) => {
      const abort = () => {
        cancelled = true
        reject(new Error('cancelled'))
      }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
    return async () => {}
  })
  const mounted = runtime.mount(first)
  const failure = mounted.then(() => null, String)
  await runtime.unmount(first)
  expect(await failure).toContain('cancelled')
  expect(cancelled).toBe(true)
  const foreign = new TestWindow({ url: 'https://foreign.test/' }) as unknown as Window
  expect(await runtime.mount(foreign).then(() => null, String)).toContain('origin mismatch')
  await runtime.close()
})
