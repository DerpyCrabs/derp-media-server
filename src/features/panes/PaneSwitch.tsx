import type { Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { createMemo } from 'solid-js'
import { Dynamic } from '@solidjs/web'

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
      case undefined:
        return undefined
    }
    return undefined
  })

  return <Dynamic component={activeRenderer()} />
}
