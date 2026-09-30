import { view, type JSX } from 'effectweb'
export type FileExplorerListingProps = Readonly<{
  viewMode: 'list' | 'grid'
  renderGrid: () => JSX.Element
  renderList: () => JSX.Element
}>
export const FileExplorerListing = view<FileExplorerListingProps>((props) =>
  props.viewMode === 'grid' ? props.renderGrid() : props.renderList(),
)
