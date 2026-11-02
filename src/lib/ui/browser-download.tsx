import { viewWindow } from '@/lib/browser/view-window'
import { controllerView, modelOwner, view, type JSX, type ControllerHost } from 'effectweb'
export const BrowserDownload = controllerView(
  {
    controller: (props: { children: JSX.Element }, host: ControllerHost) => {
      const window = viewWindow(host)
      const owner = modelOwner({ props, visible: !window.derpDesktop })
      return {
        source: owner.source,
        lifetime: owner,
        receive: (props: { children: JSX.Element }) => owner.patch({ props }),
      }
    },
  },
  view((model) => (model.visible ? model.props.children : null)),
)
