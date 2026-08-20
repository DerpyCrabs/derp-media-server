import { expect, test } from 'bun:test'
import { startPointerGesture } from '@/lib/ui/start-pointer-gesture'
import './test-dom-globals'

const pointerEvent = (type: string, pointerId: number) =>
  new document.defaultView!.PointerEvent(type, { pointerId })

test('pointerup commits a pointer gesture once and tears it down', () => {
  const events: string[] = []

  startPointerGesture({
    pointerId: 7,
    move: () => events.push('move'),
    commit: () => events.push('commit'),
    cancel: () => events.push('cancel'),
  })

  document.dispatchEvent(pointerEvent('pointermove', 7))
  document.dispatchEvent(pointerEvent('pointerup', 7))
  document.dispatchEvent(pointerEvent('pointercancel', 7))
  document.defaultView!.dispatchEvent(new Event('blur'))

  expect(events).toEqual(['move', 'commit'])
})

test('pointercancel cancels a pointer gesture once without committing', () => {
  const events: string[] = []

  startPointerGesture({
    pointerId: 9,
    move: () => events.push('move'),
    commit: () => events.push('commit'),
    cancel: () => events.push('cancel'),
  })

  document.dispatchEvent(pointerEvent('pointermove', 9))
  document.dispatchEvent(pointerEvent('pointercancel', 9))
  document.dispatchEvent(pointerEvent('pointerup', 9))

  expect(events).toEqual(['move', 'cancel'])
})

test('window blur cancels the active pointer gesture once', () => {
  const events: string[] = []

  startPointerGesture({
    pointerId: 11,
    move: () => events.push('move'),
    commit: () => events.push('commit'),
    cancel: () => events.push('cancel'),
  })

  document.defaultView!.dispatchEvent(new Event('blur'))
  expect(events).toEqual(['cancel'])

  document.dispatchEvent(pointerEvent('pointercancel', 11))
  expect(events).toEqual(['cancel'])
})

test('Escape cancels the active pointer gesture instead of committing it', () => {
  const events: string[] = []

  startPointerGesture({
    pointerId: 13,
    move: () => events.push('move'),
    commit: () => events.push('commit'),
    cancel: () => events.push('cancel'),
  })

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  document.dispatchEvent(pointerEvent('pointerup', 13))

  expect(events).toEqual(['cancel'])
})

test('manual cancellation tears down the gesture once', () => {
  const events: string[] = []

  const cancel = startPointerGesture({
    pointerId: 15,
    move: () => events.push('move'),
    commit: () => events.push('commit'),
    cancel: () => events.push('cancel'),
  })

  cancel()
  cancel()
  document.dispatchEvent(pointerEvent('pointerup', 15))

  expect(events).toEqual(['cancel'])
})

test('events from another pointer do not move or finish the gesture', () => {
  const events: string[] = []

  startPointerGesture({
    pointerId: 17,
    move: () => events.push('move'),
    commit: () => events.push('commit'),
    cancel: () => events.push('cancel'),
  })

  document.dispatchEvent(pointerEvent('pointermove', 18))
  document.dispatchEvent(pointerEvent('pointerup', 18))
  document.dispatchEvent(pointerEvent('pointerup', 17))

  expect(events).toEqual(['commit'])
})
