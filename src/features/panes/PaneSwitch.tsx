import type { Accessor, JSX } from 'solid-js'
import { createMemo } from 'solid-js'
import { Dynamic } from 'solid-js/web'

export type PaneKind = 'browser' | 'viewer' | 'hermes'

export type PaneSwitchProps = Readonly<{
  kind: Accessor<PaneKind | undefined>
  browser?: () => JSX.Element
  viewer?: () => JSX.Element
  hermes?: () => JSX.Element
}>

/** Shared surface dispatcher for the root browser, workspace windows, and canvas windows. */
export function PaneSwitch(props: PaneSwitchProps) {
  const activeRenderer = createMemo(() => {
    switch (props.kind()) {
      case 'browser':
        return props.browser
      case 'viewer':
        return props.viewer
      case 'hermes':
        return props.hermes
      default:
        return undefined
    }
  })

  return <Dynamic component={activeRenderer()} />
}
