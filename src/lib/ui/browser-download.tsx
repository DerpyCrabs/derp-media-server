import { viewWindow } from '@/lib/browser/view-window'
import {
  controllerView,
  modelOwner,
  ownerController,
  view,
  type JSX,
  type ControllerHost,
} from 'effectweb'
export const BrowserDownload = controllerView(
  {
    controller: (props: { children: JSX.Element }, host: ControllerHost) => {
      const window = viewWindow(host)
      const owner = modelOwner({ props, visible: !window.derpDesktop })
      return { ...ownerController(owner) }
    },
  },
  view((model) => (model.visible ? model.props.children : null)),
)
