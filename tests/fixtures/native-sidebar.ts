import type { BrowserContext } from '@playwright/test'

export const nativeSidebar = (context: BrowserContext) =>
  context.addInitScript(() => {
    if (location.pathname !== '/desktop') return
    Object.assign(window, {
      derpDesktop: {
        ready: async () => {},
        onBeforeClose: () => () => {},
        onOpen: () => () => {},
        places: async () => [],
      },
    })
  })
