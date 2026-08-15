import type { Accessor, JSX } from 'solid-js'
import { Match, Switch } from 'solid-js'

export type FileExplorerListingProps = Readonly<{
  viewMode: Accessor<'list' | 'grid'>
  renderGrid: () => JSX.Element
  renderList: () => JSX.Element
}>

/** Shared view-mode dispatcher; hosts only provide surface-specific item markup. */
export function FileExplorerListing(props: FileExplorerListingProps) {
  return (
    <Switch>
      <Match when={props.viewMode() === 'grid'}>{props.renderGrid()}</Match>
      <Match when={props.viewMode() === 'list'}>{props.renderList()}</Match>
    </Switch>
  )
}
