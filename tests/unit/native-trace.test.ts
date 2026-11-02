import { afterEach, expect, test } from 'bun:test'
import { beginNativeOperation, finishNativeOperation } from '@/desktop/native-trace'

const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'window', original)
  else Reflect.deleteProperty(globalThis, 'window')
})
function install(trace?: (...values: number[]) => void) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { derpDesktop: { trace } },
  })
}
test('ordinary clients need no observer or work allocation', () => {
  install()
  expect(beginNativeOperation(1, '/Source')).toBeUndefined()
  finishNativeOperation(undefined)
})
test('events carry scalar correlation and finish only once', () => {
  const rows: number[][] = []
  install((...values) => rows.push(values))
  const first = beginNativeOperation(1, '/Source')
  const second = beginNativeOperation(1, '/Source')
  finishNativeOperation(first)
  finishNativeOperation(first, 13)
  finishNativeOperation(second, 12)
  expect(rows.map((r) => r[0])).toEqual([11, 11, 10, 12])
  expect(rows[0]![1]).not.toBe(rows[1]![1])
  expect(rows[0]!.slice(1)).toEqual(rows[2]!.slice(1))
  expect(rows[0]![3]).toBe(rows[1]![3])
})
test('cancellation cannot later be reported as successful', () => {
  const rows: number[][] = []
  install((...values) => rows.push(values))
  const operation = beginNativeOperation(2, '/image.png')
  finishNativeOperation(operation, 13)
  finishNativeOperation(operation)
  expect(rows.map((r) => r[0])).toEqual([11, 13])
})

test('completion stays with its originating surface when another window becomes current', () => {
  const first: number[][] = [],
    second: number[][] = []
  install((...values) => first.push(values))
  const operation = beginNativeOperation(1, '/Source')
  install((...values) => second.push(values))
  finishNativeOperation(operation)
  expect(first.map((row) => row[0])).toEqual([11, 10])
  expect(second).toEqual([])
  expect(beginNativeOperation(1, '/ordinary-page', null)).toBeUndefined()
  expect(second).toEqual([])
})
