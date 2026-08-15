import type { FileItem } from '@/lib/files/types'
import type { Accessor, JSX } from 'solid-js'
import { Show, children } from 'solid-js'
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
  files: Accessor<FileItem[]>
  viewMode: Accessor<'list' | 'grid'>
  includeParent: Accessor<boolean>
  scrollTarget: FileExplorerScrollTarget
  scrollScope?: Accessor<string | undefined>
  loading: Accessor<boolean>
  deferredLoading: Accessor<boolean>
  error?: Accessor<string | undefined>
  onRetry?: () => void
  showEmpty: Accessor<boolean>
  canUpload: Accessor<boolean>
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
export function FileExplorerView(props: FileExplorerViewProps) {
  const showError = () => props.error?.()
  // Solid resolves children lazily; reading props.children twice would mount the subtree twice.
  const content = children(() => props.children)

  return (
    <>
      <Show when={showError()}>
        <DirectoryListingErrorPanel onRetry={() => props.onRetry?.()} detail={showError()} />
      </Show>
      <Show when={!showError()}>
        {content()}
        <DirectoryListingLoading show={props.loading() && props.deferredLoading()} />
        <Show when={!props.loading() && content() === undefined}>
          <FileExplorerListing
            viewMode={props.viewMode}
            renderGrid={() => (
              <div class='px-4 py-4'>
                <Show when={props.renderParentCard && props.renderFileCard}>
                  <VirtualDirectoryGrid
                    files={props.files}
                    includeParent={props.includeParent}
                    scrollTarget={props.scrollTarget}
                    scrollScope={props.scrollScope}
                    class={props.gridClass}
                    renderParentCard={props.renderParentCard!}
                    renderFileCard={props.renderFileCard!}
                  />
                </Show>
                <DirectoryListingEmpty show={props.showEmpty()} canUpload={props.canUpload()} />
              </div>
            )}
            renderList={() => (
              <Show when={props.renderParentRow && props.renderFileRow}>
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
                        show={props.showEmpty()}
                        canUpload={props.canUpload()}
                      />
                    )
                  }
                />
              </Show>
            )}
          />
        </Show>
      </Show>
    </>
  )
}
