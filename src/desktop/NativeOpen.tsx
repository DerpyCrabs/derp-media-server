import { viewWindow } from '@/lib/browser/view-window'
import type { ControllerHost } from 'effectweb'
import { controllerView, modelOwner, view } from 'effectweb'
import { Button } from '@/lib/ui/button'
import { DropdownMenu, type DropdownMenuProps } from '@/lib/ui/menu'
import { runDesktopOperation } from './operations'

function nativeOpen(path: () => string | undefined, window: Window) {
  const bridge = window.derpDesktop
  return {
    available: typeof bridge?.openDefault === 'function',
    open: () => {
      const target = path()
      if (bridge?.openDefault && target)
        runDesktopOperation(() => bridge.openDefault!(target), window)
    },
  }
}

export const NativeOpenButton = controllerView(
  {
    controller: (
      props: { path: string; onDone?: () => void; role?: 'menuitem' },
      host: ControllerHost,
    ) => {
      const owner = modelOwner({ props, available: false })
      const action = nativeOpen(() => owner.read().props.path, viewWindow(host))
      owner.patch({ available: action.available })
      return {
        source: owner.source,
        lifetime: owner,
        open: action.open,
        receive: (props: { path: string; onDone?: () => void; role?: 'menuitem' }) =>
          owner.patch({ props }),
      }
    },
  },
  view((model) =>
    model.available && model.props.path ? (
      <Button
        variant='ghost'
        role={model.props.role}
        class='h-auto min-h-8 w-full justify-start whitespace-normal rounded-md px-2 py-1.5 text-left font-normal'
        onClick={() => {
          model.actions.open()
          model.props.onDone?.()
        }}
      >
        Open in default app
      </Button>
    ) : null,
  ),
)

export const NativeFileMenu = controllerView(
  {
    controller: (props: DropdownMenuProps & { path?: string }, host: ControllerHost) => {
      const owner = modelOwner({ props, available: false })
      const action = nativeOpen(() => owner.read().props.path, viewWindow(host))
      owner.patch({ available: action.available })
      return {
        source: owner.source,
        lifetime: owner,
        open: action.open,
        receive: (props: DropdownMenuProps & { path?: string }) => owner.patch({ props }),
      }
    },
  },
  view((model) => (
    <DropdownMenu
      {...model.props}
      items={[
        ...(model.available && model.props.path
          ? [{ kind: 'item' as const, label: 'Open in default app', onSelect: model.actions.open }]
          : []),
        ...model.props.items,
      ]}
    />
  )),
)
