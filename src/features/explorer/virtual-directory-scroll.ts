type VirtualFileScroller = {
  hasPath: (path: string) => boolean
  scrollToPath: (path: string) => void
}

const scrollers = new Map<string, VirtualFileScroller>()

export function registerVirtualFileScroller(scope: string, scroller: VirtualFileScroller) {
  scrollers.set(scope, scroller)

  return () => {
    if (scrollers.get(scope) === scroller) {
      scrollers.delete(scope)
    }
  }
}

export function getVirtualFileScroller(scope: string | undefined) {
  if (!scope) return undefined
  return scrollers.get(scope)
}
