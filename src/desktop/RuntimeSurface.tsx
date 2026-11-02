import { acquireWindowBreadcrumbs } from '@/features/explorer/breadcrumb-floating-store'
import { Effect, Exit, Scope } from 'effect'
import { makeMount, view } from 'effectweb'
import { DesktopPage } from './DesktopPage'
import { AppDialogHost } from '@/lib/ui/AppDialogHost'
import { FileConflictHost } from '@/features/explorer/FileConflictHost'
import { acquireWindowDialogs } from '@/lib/ui/app-dialog'
import { acquireWindowHistory } from '@/lib/browser/window-history'
import { acquireDesktopOperations } from './operations'
import { createSurfaceRuntime } from './surface-runtime'

const Surface = view<{ browserWindow: Window }>((props) => (
  <>
    <AppDialogHost />
    <FileConflictHost />
    <DesktopPage browserWindow={props.browserWindow} />
  </>
))

function copyStyles(source: Document, target: Document, signal: AbortSignal) {
  const links: HTMLLinkElement[] = []
  const pending: Promise<void>[] = []
  for (const link of source.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const copy = target.createElement('link')
    copy.rel = 'stylesheet'
    copy.href = link.href
    links.push(copy)
    pending.push(
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          copy.removeEventListener('load', loaded)
          copy.removeEventListener('error', failed)
          signal.removeEventListener('abort', aborted)
        }
        const loaded = () => {
          cleanup()
          resolve()
        }
        const failed = () => {
          cleanup()
          reject(new Error(`Stylesheet failed: ${copy.href}`))
        }
        const aborted = () => {
          cleanup()
          reject(new Error('Surface closed during stylesheet loading'))
        }
        copy.addEventListener('load', loaded)
        copy.addEventListener('error', failed)
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
        else target.head.append(copy)
      }),
    )
  }
  const theme = () => {
    const value = source.documentElement.getAttribute('data-theme')
    if (value === null) target.documentElement.removeAttribute('data-theme')
    else target.documentElement.setAttribute('data-theme', value)
  }
  theme()
  const observer = new MutationObserver(theme)
  observer.observe(source.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return {
    ready: Promise.all(pending),
    dispose() {
      observer.disconnect()
      for (const link of links) link.remove()
    },
  }
}

export function createAppSurfaceRuntime(document: Document) {
  const origin = document.location.origin
  return createSurfaceRuntime(origin, async (target, signal) => {
    const root = target.document.getElementById('root')
    if (!root) throw new Error('App surface root is missing')
    const scope = Scope.makeUnsafe()
    const close = () => Effect.runPromise(Scope.close(scope, Exit.void))
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const styles = yield* Effect.acquireRelease(
            Effect.sync(() => copyStyles(document, target.document, signal)),
            (styles) => Effect.sync(() => styles.dispose()),
          )
          yield* Effect.tryPromise(() => styles.ready)
          for (const acquire of [
            acquireWindowDialogs,
            acquireWindowHistory,
            acquireDesktopOperations,
            acquireWindowBreadcrumbs,
          ]) {
            yield* Effect.acquireRelease(
              Effect.sync(() => acquire(target)),
              (value) => Effect.sync(() => value.dispose()),
            )
          }
          yield* makeMount(root, Surface, { browserWindow: target })
        }).pipe(Effect.provideService(Scope.Scope, scope)),
        { signal },
      )
      return close
    } catch (error) {
      await close()
      if (!signal.aborted) root.textContent = `Application failed to open: ${String(error)}`
      throw error
    }
  })
}

declare global {
  interface Window {
    derpRuntime?: {
      register(
        mount: (target: Window) => Promise<void>,
        unmount: (target: Window) => Promise<void>,
        shutdown: () => Promise<void>,
      ): void
    }
  }
}
