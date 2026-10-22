import { view } from 'effectweb'
import type { ReaderPage } from '../reader-position'
import type { ReaderSelectionMode } from '../reader-position'
import type { ReaderSelection } from '../ReaderSelectionMenu'
import { RegionLayer } from '../RegionLayer'
export const ImageContent = view<{
  page: ReaderPage
  zoom: number
  selectionMode: ReaderSelectionMode
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}>((props) => {
  return (
    <div
      class='relative touch-none overflow-hidden rounded-lg border border-[#c6d0ca] bg-[#fffdf8] shadow-[0_7px_20px_rgb(0_0_0/28%)]'
      style={{ width: `${Math.min(props.page.width * props.zoom, 1400)}px` }}
    >
      <img
        src={props.page.source}
        alt={props.page.name}
        class='block h-auto w-full select-none'
        draggable={false}
        data-testid='reader-image-page'
      />
      {props.selectionMode === 'image' ? <RegionLayer onRegion={props.onRegion} /> : null}
    </div>
  )
})
