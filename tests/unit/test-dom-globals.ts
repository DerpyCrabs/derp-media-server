import { Window as HappyWindow } from 'happy-dom'

const testWindow = new HappyWindow({ url: 'http://localhost/' })
const installedGlobals = [
  'document',
  'MutationObserver',
  'ResizeObserver',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLImageElement',
  'Node',
  'Text',
  'Document',
  'DOMParser',
  'Window',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'ClipboardEvent',
  'DataTransfer',
  'File',
  'getComputedStyle',
] as const

for (const name of installedGlobals) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: testWindow[name],
  })
}
