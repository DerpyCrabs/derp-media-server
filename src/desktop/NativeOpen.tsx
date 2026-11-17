import { Effect } from 'effect'
import { dialogsForWindow } from '@/lib/ui/app-dialog'
import { viewWindow } from '@/lib/browser/view-window'
import type { ControllerHost } from 'effectweb'
import { controllerView, modelOwner, ownerController, view } from 'effectweb'
import { MenuItem } from '@/lib/ui/menu-item'
import AppWindow from '@effectweb/lucide/icons/app-window'
import ExternalLink from '@effectweb/lucide/icons/external-link'
import { DropdownMenu, type DropdownMenuProps } from '@/lib/ui/menu'
import { runDesktopOperation } from './operations'

function nativeOpen(path: () => string | undefined, window: Window) {
  const bridge = window.derpDesktop
  return {
    available: typeof bridge?.openDefault === 'function',
    runnable: typeof bridge?.runProgram === 'function',
    run: () => {
      const target = path()
      if (bridge?.runProgram && target)
        runDesktopOperation(() => bridge.runProgram!(target), window)
    },
    chooser: typeof bridge?.applications === 'function' && typeof bridge?.openWith === 'function',
    choose: () => {
      const target = path()
      if (!target || !bridge?.applications || !bridge.openWith) return
      runDesktopOperation(async () => {
        const applications = await bridge.applications!(target)
        if (!applications.length)
          throw new Error('No installed applications are registered for this file type')
        // Choosing is a user decision, not an in-flight desktop operation.
        // Keep the chooser unobscured; publish pending again only for launch.
        void Effect.runPromise(
          dialogsForWindow(window).choose(
            'Open with',
            target.split('/').at(-1) ?? target,
            applications.map((app) => ({ id: app.id, label: app.name })),
          ),
        ).then(
          (selected) => {
            if (selected && !window.closed)
              runDesktopOperation(() => bridge.openWith!(target, selected), window)
          },
          (error) => {
            if (!window.closed) runDesktopOperation(() => Promise.reject(error), window)
          },
        )
      }, window)
    },
    open: () => {
      const target = path()
      if (bridge?.openDefault && target)
        runDesktopOperation(() => bridge.openDefault!(target), window)
    },
  }
}

type NativeOpenProps = {
  path: string
  runnable?: boolean
  onDone?: () => void
  role?: 'menuitem'
  chooserLabel?: string
}

export const NativeOpenButton = controllerView(
  {
    controller: (props: NativeOpenProps, host: ControllerHost) => {
      const owner = modelOwner({ props, available: false, chooser: false, runnable: false })
      const action = nativeOpen(() => owner.read().props.path, viewWindow(host))
      owner.patch({
        available: action.available,
        chooser: action.chooser,
        runnable: action.runnable,
      })
      return {
        ...ownerController(owner),
        run: action.run,
        open: action.open,
        choose: action.choose,
      }
    },
  },
  view((model) =>
    (model.available || model.runnable) && model.props.path ? (
      <>
        {model.runnable && model.props.runnable ? (
          <MenuItem
            role={model.props.role}
            onClick={() => {
              model.actions.run()
              model.props.onDone?.()
            }}
          >
            <AppWindow class='size-4 shrink-0' stroke-width={2} />
            Run as program
          </MenuItem>
        ) : null}
        {model.available ? (
          <MenuItem
            data-native-open='default'
            role={model.props.role}
            onClick={() => {
              model.actions.open()
              model.props.onDone?.()
            }}
          >
            <ExternalLink class='size-4 shrink-0' stroke-width={2} />
            Open in default app
          </MenuItem>
        ) : null}
        {model.chooser ? (
          <MenuItem
            data-native-open='chooser'
            role={model.props.role}
            onClick={() => {
              model.actions.choose()
              model.props.onDone?.()
            }}
          >
            <AppWindow class='size-4 shrink-0' stroke-width={2} />
            {model.props.chooserLabel ?? 'Open with…'}
          </MenuItem>
        ) : null}
      </>
    ) : null,
  ),
)

export const NativeFileMenu = controllerView(
  {
    controller: (props: DropdownMenuProps & { path?: string }, host: ControllerHost) => {
      const owner = modelOwner({ props, available: false, chooser: false })
      const action = nativeOpen(() => owner.read().props.path, viewWindow(host))
      owner.patch({ available: action.available, chooser: action.chooser })
      return { ...ownerController(owner), open: action.open, choose: action.choose }
    },
  },
  view((model) => (
    <DropdownMenu
      {...model.props}
      items={[
        ...(model.available && model.props.path
          ? [{ kind: 'item' as const, label: 'Open in default app', onSelect: model.actions.open }]
          : []),
        ...(model.chooser && model.props.path
          ? [{ kind: 'item' as const, label: 'Open with…', onSelect: model.actions.choose }]
          : []),
        ...model.props.items,
      ]}
    />
  )),
)
