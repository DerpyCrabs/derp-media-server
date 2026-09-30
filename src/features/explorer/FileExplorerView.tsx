import { view, type JSX } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import {
  DirectoryListingEmpty,
  DirectoryListingEmptyTableRow,
  DirectoryListingErrorPanel,
  DirectoryListingLoading,
} from '@/features/explorer/DirectoryListingFeedback'
import { VirtualDirectoryGrid } from '@/features/explorer/VirtualDirectoryGrid'
import { VirtualDirectoryList } from '@/features/explorer/VirtualDirectoryList'
import { FileExplorerListing } from './FileExplorerListing'
export type FileExplorerScrollTarget =
  | { kind: 'window' }
  | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }
export type FileExplorerViewProps = Readonly<{
  files: readonly FileItem[]
  viewMode: 'list' | 'grid'
  includeParent: boolean
  scrollTarget: FileExplorerScrollTarget
  scrollScope?: string | undefined
  loading: boolean
  deferredLoading: boolean
  error?: string | undefined
  onRetry?: () => void
  showEmpty: boolean
  canUpload: boolean
  renderParentCard?: () => JSX.Element
  renderFileCard?: (file: FileItem) => JSX.Element
  renderParentRow?: () => JSX.Element
  renderFileRow?: (file: FileItem) => JSX.Element
  gridClass?: string
  listClass?: string
  listColSpan?: number
  listSizeColumnClass?: string
  listEmptyRow?: () => JSX.Element
  children?: JSX.Element
}>
/** Shared directory listing surface. Hosts own data, actions, and row rendering. */
export const FileExplorerView = view<FileExplorerViewProps>((props) => {
  const showError = () => props.error
  const content = () => props.children
  return (
    <>
      {showError() ? (
        <DirectoryListingErrorPanel onRetry={() => props.onRetry?.()} detail={showError()} />
      ) : null}
      {!showError() ? (
        <>
          {content()}
          <DirectoryListingLoading show={props.loading && props.deferredLoading} />
          {!props.loading && content() === undefined ? (
            <FileExplorerListing
              viewMode={props.viewMode}
              renderGrid={() => (
                <div class='px-4 py-4'>
                  {props.renderParentCard && props.renderFileCard ? (
                    <VirtualDirectoryGrid
                      files={props.files}
                      includeParent={props.includeParent}
                      scrollTarget={props.scrollTarget}
                      scrollScope={props.scrollScope}
                      class={props.gridClass}
                      renderParentCard={props.renderParentCard!}
                      renderFileCard={props.renderFileCard!}
                    />
                  ) : null}
                  <DirectoryListingEmpty show={props.showEmpty} canUpload={props.canUpload} />
                </div>
              )}
              renderList={() =>
                props.renderParentRow && props.renderFileRow ? (
                  <VirtualDirectoryList
                    files={props.files}
                    includeParent={props.includeParent}
                    scrollTarget={props.scrollTarget}
                    scrollScope={props.scrollScope}
                    colSpan={props.listColSpan ?? 3}
                    sizeColumnClass={props.listSizeColumnClass}
                    class={props.listClass}
                    renderParentRow={props.renderParentRow!}
                    renderFileRow={props.renderFileRow!}
                    renderEmptyRow={() =>
                      props.listEmptyRow?.() ?? (
                        <DirectoryListingEmptyTableRow
                          show={props.showEmpty}
                          canUpload={props.canUpload}
                        />
                      )
                    }
                  />
                ) : null
              }
            />
          ) : null}
        </>
      ) : null}
    </>
  )
})
