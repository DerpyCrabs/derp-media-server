import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { scrollAffectsElement } from '@/lib/ui/scroll-affects-element'

test('only the target, scrolling ancestors, and document affect its geometry', () => {
  const window = new Window()
  const document = window.document
  const outer = document.createElement('div')
  const inner = document.createElement('div')
  const target = document.createElement('div')
  const child = document.createElement('div')
  const sibling = document.createElement('div')
  document.body.append(outer, sibling)
  outer.append(inner)
  inner.append(target)
  target.append(child)
  const relevant: boolean[] = []
  document.addEventListener(
    'scroll',
    (event) =>
      relevant.push(scrollAffectsElement(event as unknown as Event, target as unknown as Element)),
    true,
  )
  for (const node of [sibling, child, target, inner, outer, document])
    node.dispatchEvent(new window.Event('scroll'))
  expect(relevant).toEqual([false, false, true, true, true, true])
  sibling.append(target)
  outer.dispatchEvent(new window.Event('scroll'))
  sibling.dispatchEvent(new window.Event('scroll'))
  expect(relevant.slice(-2)).toEqual([false, true])
  window.close()
})
