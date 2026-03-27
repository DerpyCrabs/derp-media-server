import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  findMergeTarget,
  mergeTargetFromElement,
  workspaceWindowsByGroupId,
} from '@/src/workspace/merge-target'

const OrigElement = globalThis.Element

beforeEach(() => {
  function ElementShim() {}
  ElementShim.prototype = Object.create(Object.getPrototypeOf(Object.prototype))
  globalThis.Element = ElementShim as unknown as typeof globalThis.Element
})

afterEach(() => {
  globalThis.Element = OrigElement
})

function asElem<T extends object>(props: T): Element {
  return Object.assign(
    Object.create((globalThis as unknown as { Element: { prototype: object } }).Element.prototype),
    props,
  ) as Element
}

function browser(id: string, gid: string): WorkspaceWindowDefinition {
  return {
    id,
    type: 'browser',
    title: id,
    iconName: null,
    iconPath: '',
    iconType: MediaType.FOLDER,
    iconIsVirtual: false,
    source: { kind: 'local', rootPath: null },
    initialState: { dir: '/' },
    tabGroupId: gid,
    layout: { minimized: false, zIndex: 1 },
  }
}

describe('workspaceWindowsByGroupId', () => {
  test('groups in first-seen order', () => {
    const windows = [browser('a', 'g1'), browser('b', 'g2'), browser('c', 'g1')]
    const map = workspaceWindowsByGroupId(windows)
    expect(map.get('g1')?.map((w) => w.id)).toEqual(['a', 'c'])
    expect(map.get('g2')?.map((w) => w.id)).toEqual(['b'])
  })
})

describe('mergeTargetFromElement', () => {
  test('parses drop slot attribute', () => {
    const el = asElem({
      closest(sel: string) {
        if (sel === '[data-window-group]') return null
        if (sel === '[data-tab-drop-slot]') return this as unknown as Element
        return null
      },
      getAttribute(n: string) {
        return n === 'data-tab-drop-slot' ? 'g2:2' : null
      },
      hasAttribute(n: string) {
        return n === 'data-tab-drop-slot'
      },
    })
    const by = workspaceWindowsByGroupId([browser('w', 'g1')])
    expect(mergeTargetFromElement(el, by, 'g1', 0)).toEqual({ groupId: 'g2', insertIndex: 2 })
  })

  test('returns null for slot under dragged group', () => {
    const groupWrap = asElem({
      getAttribute(n: string) {
        return n === 'data-window-group' ? 'g1' : null
      },
      closest(sel: string) {
        if (sel === '[data-window-group]') return this as Element
        return null
      },
    })
    const el = asElem({
      closest(sel: string) {
        if (sel === '[data-window-group]') return groupWrap
        if (sel === '[data-tab-drop-slot]') return this as unknown as Element
        return null
      },
      getAttribute(n: string) {
        return n === 'data-tab-drop-slot' ? 'g1:1' : null
      },
      hasAttribute(n: string) {
        return n === 'data-tab-drop-slot'
      },
    })
    const by = workspaceWindowsByGroupId([browser('w', 'g1')])
    expect(mergeTargetFromElement(el, by, 'g1', 0)).toBeNull()
  })

  test('tab body uses pointer fraction for insert index', () => {
    const group = asElem({
      getAttribute(n: string) {
        return n === 'data-window-group' ? 'g1' : null
      },
      closest(sel: string) {
        if (sel === '[data-window-group]') return this as Element
        return null
      },
    })
    const tab = asElem({
      getAttribute(n: string) {
        return n === 'data-workspace-tab-id' ? 't1' : null
      },
      closest(sel: string) {
        if (sel === '[data-workspace-tab-id]') return this as Element
        if (sel === '[data-window-group]') return group
        return null
      },
      getBoundingClientRect() {
        return {
          left: 100,
          width: 100,
          top: 0,
          right: 200,
          bottom: 40,
          height: 40,
          x: 100,
          y: 0,
        } as DOMRect
      },
    })
    const by = workspaceWindowsByGroupId([browser('t0', 'g1'), browser('t1', 'g1')])
    expect(mergeTargetFromElement(tab, by, 'g2', 139)).toEqual({ groupId: 'g1', insertIndex: 1 })
    expect(mergeTargetFromElement(tab, by, 'g2', 141)).toEqual({ groupId: 'g1', insertIndex: 2 })
  })
})

describe('findMergeTarget', () => {
  test('uses elementsFromPoint stack', () => {
    const docHolder = globalThis as typeof globalThis & { document?: Partial<Document> }
    if (!docHolder.document) {
      docHolder.document = {} as Document
    }
    const slot = asElem({
      closest(sel: string) {
        if (sel === '[data-window-group]') return null
        if (sel === '[data-tab-drop-slot]') return this as unknown as Element
        return null
      },
      getAttribute(n: string) {
        return n === 'data-tab-drop-slot' ? 'dest:0' : null
      },
      hasAttribute(n: string) {
        return n === 'data-tab-drop-slot'
      },
    })

    const windows = [browser('dragged', 'src'), browser('x', 'dest')]
    const docAny = docHolder.document as unknown as {
      elementsFromPoint?: (x: number, y: number) => Element[]
    }
    const orig = docAny.elementsFromPoint
    docAny.elementsFromPoint = () => [slot]

    try {
      expect(findMergeTarget(windows, 'dragged', 10, 10)).toEqual({
        groupId: 'dest',
        insertIndex: 0,
      })
    } finally {
      if (orig) docAny.elementsFromPoint = orig
      else delete docAny.elementsFromPoint
    }
  })
})
