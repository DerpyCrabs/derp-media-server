import { view, type JSX } from 'effectweb'
export type PaneKind = 'browser' | 'viewer' | 'hermes'
export type PaneSwitchProps = Readonly<{
  kind: PaneKind | undefined
  browser?: () => JSX.Element
  viewer?: () => JSX.Element
  hermes?: () => JSX.Element
}>
export const PaneSwitch = view<PaneSwitchProps>((props) =>
  props.kind === 'browser'
    ? props.browser?.()
    : props.kind === 'viewer'
      ? props.viewer?.()
      : props.kind === 'hermes'
        ? props.hermes?.()
        : null,
)
