const handlers = new Set<() => Promise<unknown> | void>()

export function registerDesktopCloseHandler(handler: () => Promise<unknown> | void) {
  if (!window.derpDesktop) return undefined
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export async function flushDesktopClose() {
  await Promise.all([...handlers].map(async (handler) => handler()))
}
