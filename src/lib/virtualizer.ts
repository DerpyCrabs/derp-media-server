import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  windowScroll,
  type PartialKeys,
  type VirtualizerOptions,
} from '@tanstack/virtual-core'
import { createEffect, createSignal, createStore, merge, onSettled, reconcile } from 'solid-js'

export * from '@tanstack/virtual-core'

function trackVirtualizerOptions<T extends object>(options: T): T {
  for (const key of Object.keys(options) as Array<keyof T>) {
    void options[key]
  }
  return options
}

function createVirtualizerBase<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
>(
  options: VirtualizerOptions<TScrollElement, TItemElement>,
): Virtualizer<TScrollElement, TItemElement> {
  const resolvedOptions = merge(options) as VirtualizerOptions<TScrollElement, TItemElement>
  const instance = new Virtualizer<TScrollElement, TItemElement>(resolvedOptions)
  const [virtualItems, setVirtualItems] = createStore(instance.getVirtualItems())
  const [totalSize, setTotalSize] = createSignal(instance.getTotalSize())

  const virtualizer = new Proxy(instance, {
    get(target, prop: keyof Virtualizer<TScrollElement, TItemElement>) {
      if (prop === 'getVirtualItems') return () => virtualItems
      // eslint-disable-next-line solid/reactivity
      if (prop === 'getTotalSize') return () => totalSize()
      return Reflect.get(target, prop)
    },
  })

  virtualizer.setOptions(resolvedOptions)

  onSettled(() => {
    const cleanup = virtualizer._didMount()
    virtualizer._willUpdate()
    return cleanup
  })

  createEffect(
    () => {
      const nextOptions = merge(resolvedOptions, options, {
        onChange: (changed: Virtualizer<TScrollElement, TItemElement>, sync: boolean) => {
          changed._willUpdate()
          setVirtualItems(reconcile(changed.getVirtualItems(), 'index'))
          setTotalSize(changed.getTotalSize())
          options.onChange?.(changed, sync)
        },
      })
      return trackVirtualizerOptions(nextOptions)
    },
    (nextOptions) => {
      virtualizer.setOptions(nextOptions)
      virtualizer._willUpdate()
      setVirtualItems(reconcile(instance.getVirtualItems(), 'index'))
      setTotalSize(instance.getTotalSize())
    },
  )

  return virtualizer
}

export function createVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: PartialKeys<
    VirtualizerOptions<TScrollElement, TItemElement>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  >,
): Virtualizer<TScrollElement, TItemElement> {
  const resolvedOptions = merge(
    {
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
    },
    options,
  )
  return createVirtualizerBase(resolvedOptions)
}

export function createWindowVirtualizer<TItemElement extends Element>(
  options: PartialKeys<
    VirtualizerOptions<Window, TItemElement>,
    'getScrollElement' | 'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  >,
): Virtualizer<Window, TItemElement> {
  const resolvedOptions = merge(
    {
      getScrollElement: () => (typeof document !== 'undefined' ? window : null),
      observeElementRect: observeWindowRect,
      observeElementOffset: observeWindowOffset,
      scrollToFn: windowScroll,
      initialOffset: () => (typeof document !== 'undefined' ? window.scrollY : 0),
    },
    options,
  )
  return createVirtualizerBase(resolvedOptions)
}
