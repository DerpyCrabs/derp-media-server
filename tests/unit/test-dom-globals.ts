import { Window as HappyWindow } from 'happy-dom'

if (typeof globalThis.DOMParser === 'undefined') {
  const window = new HappyWindow({ url: 'https://localhost/' })
  ;(globalThis as unknown as { DOMParser: typeof window.DOMParser }).DOMParser = window.DOMParser
}
