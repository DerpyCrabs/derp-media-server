import { MediaType, type FileItem } from '@/lib/files/types'
import { isPathEditable } from '@/lib/files/path-utils'
import { FloatingContextMenu } from './FloatingContextMenu'
import AppWindow from 'lucide-solid/icons/app-window'
import BookOpen from 'lucide-solid/icons/book-open'
import Columns2 from 'lucide-solid/icons/columns-2'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import ExternalLink from 'lucide-solid/icons/external-link'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Pencil from 'lucide-solid/icons/pencil'
import Pin from 'lucide-solid/icons/pin'
import Settings from 'lucide-solid/icons/settings'
import Library from 'lucide-solid/icons/library'
import Star from 'lucide-solid/icons/star'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createSignal } from 'solid-js'
import type { VirtualCapability, VirtualEntry } from '@/lib/files/virtual-directory'

type MenuState = { x: number; y: number; file: FileItem }

type FileRowContextMenuProps = {
  menu: Accessor<MenuState | null>
  editableFolders: Accessor<string[]>
  isCurrentDirEditable: Accessor<boolean>
  hasEditableFolders: Accessor<boolean>
  onDismiss: () => void
  onDownload: (file: FileItem) => void
  onDelete: (file: FileItem) => void
  onAddToTaskbar?: (file: FileItem) => void
  onOpenInNewTab?: (file: FileItem) => void
  openInNewTabLabel?: string
  /** When true, show "Open in new tab" for files too. Default: folders only. */
  showOpenInNewTabForFiles?: boolean
  /** Open beside the file browser in split view. */
  onOpenInSplitView?: (file: FileItem) => void
  onOpenInOtherSurface?: (file: FileItem) => void
  onOpenWithBrowser?: (file: FileItem) => void
  onOpenWithReader?: (file: FileItem) => void
  openInOtherSurfaceLabel?: string
  onToggleFavorite?: (file: FileItem) => void
  isFavorite?: (file: FileItem) => boolean
  onRename?: (file: FileItem) => void
  onMove?: (file: FileItem) => void
  onCopy?: (file: FileItem) => void
  onSetIcon?: (file: FileItem) => void
  onToggleKnowledgeBase?: (file: FileItem) => void
  isKnowledgeBase?: (file: FileItem) => boolean
  /** Pick which tab bar receives items opened in a new tab. */
  onPickNewTabTarget?: () => void
  /** Normal click uses new-tab vs new-window; context menu shows the opposite for files. */
  defaultFileOpen?: Accessor<'new-tab' | 'new-window'>
  /** Open a file in a floating window when default mode is new-tab. */
  onOpenFileInNewWindow?: (file: FileItem) => void
  getVirtualEntry?: (file: FileItem) => VirtualEntry | undefined
  onVirtualAction?: (action: VirtualCapability, file: FileItem) => void
}

export function FileRowContextMenu(props: FileRowContextMenuProps) {
  const [openWithOpen, setOpenWithOpen] = createSignal(false)
  createEffect(
    () => !!props.menu(),
    (isOpen) => {
      if (!isOpen) setOpenWithOpen(false)
    },
  )

  return (
    <FloatingContextMenu
      state={props.menu}
      anchor={(ctx) => ({ x: ctx.x, y: ctx.y })}
      onDismiss={props.onDismiss}
      data-slot='file-row-context-menu'
    >
      {(ctx) => {
        const downloadLabel = () => (ctx.file.isDirectory ? 'Download as ZIP' : 'Download')
        const virtualEntry = () => props.getVirtualEntry?.(ctx.file)
        const canVirtual = (capability: VirtualCapability) =>
          virtualEntry()?.capabilities.includes(capability) ?? false
        const showDeleteFile = () => {
          if (ctx.file.isVirtual) return false
          if (!isPathEditable(ctx.file.path, props.editableFolders())) return false
          return true
        }
        const showCopyTo = () => props.hasEditableFolders() && !ctx.file.isVirtual && !!props.onCopy
        const showMove = () => props.isCurrentDirEditable() && !ctx.file.isVirtual && !!props.onMove
        const showRename = () =>
          props.isCurrentDirEditable() && !ctx.file.isVirtual && !!props.onRename
        const showEditSeparator = () => showDeleteFile() || showMove() || showRename()

        const fileContextIsNewWindow = () =>
          !ctx.file.isDirectory &&
          props.showOpenInNewTabForFiles === true &&
          props.defaultFileOpen?.() === 'new-tab' &&
          !!props.onOpenFileInNewWindow

        const showOpenRow = () => {
          if (ctx.file.isVirtual) return false
          if (ctx.file.isDirectory) return !!props.onOpenInNewTab
          if (props.showOpenInNewTabForFiles !== true) return false
          if (fileContextIsNewWindow()) return true
          return !!props.onOpenInNewTab
        }

        const openRowPrimary = () => {
          if (fileContextIsNewWindow()) {
            props.onOpenFileInNewWindow?.(ctx.file)
          } else {
            props.onOpenInNewTab?.(ctx.file)
          }
          props.onDismiss()
        }

        const openRowPrimaryLabel = () =>
          fileContextIsNewWindow()
            ? 'Open in new window'
            : (props.openInNewTabLabel ?? 'Open in new tab')

        return (
          <>
            <Show when={canVirtual('rename')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('rename', ctx.file)
                  props.onDismiss()
                }}
              >
                Rename
              </button>
            </Show>
            <Show when={canVirtual('branch')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('branch', ctx.file)
                  props.onDismiss()
                }}
              >
                Branch
              </button>
            </Show>
            <Show when={canVirtual('moveToProject')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('moveToProject', ctx.file)
                  props.onDismiss()
                }}
              >
                Move to project…
              </button>
            </Show>
            <Show when={canVirtual('copyId')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('copyId', ctx.file)
                  props.onDismiss()
                }}
              >
                Copy session ID
              </button>
            </Show>
            <Show when={canVirtual('addProjectFolder')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('addProjectFolder', ctx.file)
                  props.onDismiss()
                }}
              >
                Add gateway directory…
              </button>
            </Show>
            <Show when={canVirtual('removeProjectFolder')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('removeProjectFolder', ctx.file)
                  props.onDismiss()
                }}
              >
                Remove gateway directory…
              </button>
            </Show>
            <Show when={canVirtual('setPrimaryFolder')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('setPrimaryFolder', ctx.file)
                  props.onDismiss()
                }}
              >
                Set primary directory…
              </button>
            </Show>
            <Show when={canVirtual('setAppearance')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('setAppearance', ctx.file)
                  props.onDismiss()
                }}
              >
                Appearance…
              </button>
            </Show>
            <Show when={canVirtual('archive')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('archive', ctx.file)
                  props.onDismiss()
                }}
              >
                Archive
              </button>
            </Show>
            <Show when={canVirtual('restore')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('restore', ctx.file)
                  props.onDismiss()
                }}
              >
                Restore
              </button>
            </Show>
            <Show when={canVirtual('deleteProject')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('deleteProject', ctx.file)
                  props.onDismiss()
                }}
              >
                Delete Project
              </button>
            </Show>
            <Show when={canVirtual('deletePermanently')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  props.onVirtualAction?.('deletePermanently', ctx.file)
                  props.onDismiss()
                }}
              >
                Delete Permanently
              </button>
            </Show>
            <Show when={props.onSetIcon && !ctx.file.isVirtual}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onSetIcon?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Pencil class='h-4 w-4 shrink-0' stroke-width={2} />
                Set icon
              </button>
            </Show>
            <Show when={props.onPickNewTabTarget}>
              <button
                type='button'
                data-slot='context-menu-item'
                data-testid='workspace-pick-new-tab-target'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                title='Choose which window receives files opened in a new tab'
                onClick={() => {
                  props.onPickNewTabTarget?.()
                  props.onDismiss()
                }}
              >
                <Settings class='h-4 w-4 shrink-0' stroke-width={2} />
                Choose where new tabs open…
              </button>
            </Show>
            <Show when={showOpenRow()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={openRowPrimary}
              >
                <Show
                  when={fileContextIsNewWindow()}
                  fallback={<ExternalLink class='h-4 w-4 shrink-0' stroke-width={2} />}
                >
                  <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                </Show>
                {openRowPrimaryLabel()}
              </button>
            </Show>
            <Show
              when={
                props.onOpenInSplitView && !ctx.file.isVirtual && ctx.file.type !== MediaType.AUDIO
              }
            >
              <button
                type='button'
                data-slot='context-menu-item'
                data-testid='workspace-file-menu-open-split-view'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onOpenInSplitView?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Columns2 class='h-4 w-4 shrink-0' stroke-width={2} />
                Open in split view
              </button>
            </Show>
            <Show
              when={
                props.onOpenWithBrowser &&
                props.onOpenWithReader &&
                !ctx.file.isVirtual &&
                ctx.file.isDirectory
              }
            >
              <div
                class='relative'
                onPointerEnter={() => setOpenWithOpen(true)}
                onPointerLeave={() => setOpenWithOpen(false)}
              >
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='open-with-menu'
                  aria-haspopup='menu'
                  aria-expanded={openWithOpen() ? 'true' : 'false'}
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => setOpenWithOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault()
                      setOpenWithOpen(true)
                    }
                  }}
                >
                  <Library class='h-4 w-4 shrink-0' stroke-width={2} />
                  <span class='flex-1 text-left'>Open with...</span>
                  <ChevronRight class='h-4 w-4 shrink-0' stroke-width={2} />
                </button>
                <Show when={openWithOpen()}>
                  <div
                    role='menu'
                    data-testid='open-with-submenu'
                    class='absolute top-[-4px] left-[calc(100%-2px)] z-10 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
                  >
                    <button
                      type='button'
                      role='menuitem'
                      data-testid='open-with-browser'
                      class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                      onClick={() => {
                        props.onOpenWithBrowser?.(ctx.file)
                        props.onDismiss()
                      }}
                    >
                      <FolderOpen class='h-4 w-4 shrink-0' stroke-width={2} />
                      Browser
                    </button>
                    <button
                      type='button'
                      role='menuitem'
                      data-testid='open-with-reader'
                      class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                      onClick={() => {
                        props.onOpenWithReader?.(ctx.file)
                        props.onDismiss()
                      }}
                    >
                      <BookOpen class='h-4 w-4 shrink-0' stroke-width={2} />
                      Reader
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={props.onOpenInOtherSurface && ctx.file.isDirectory && !ctx.file.isVirtual}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onOpenInOtherSurface?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                {props.openInOtherSurfaceLabel ?? 'Open in other view'}
              </button>
            </Show>
            <Show
              when={
                props.onAddToTaskbar &&
                (!ctx.file.isVirtual || virtualEntry()?.openTarget?.type === 'hermesSession')
              }
            >
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onAddToTaskbar?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Pin class='h-4 w-4 shrink-0' stroke-width={2} />
                Add to taskbar
              </button>
            </Show>
            <Show when={ctx.file.isDirectory && !ctx.file.isVirtual && !!props.onToggleFavorite}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onToggleFavorite?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Star
                  class={`h-4 w-4 shrink-0 ${props.isFavorite?.(ctx.file) ? 'fill-yellow-400 text-yellow-400' : ''}`}
                  stroke-width={2}
                />
                {props.isFavorite?.(ctx.file) ? 'Unfavorite' : 'Favorite'}
              </button>
            </Show>
            <Show when={ctx.file.isDirectory && props.onToggleKnowledgeBase}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onToggleKnowledgeBase?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <BookOpen
                  class={`h-4 w-4 shrink-0 ${props.isKnowledgeBase?.(ctx.file) ? 'fill-primary text-primary' : ''}`}
                  stroke-width={2}
                />
                {props.isKnowledgeBase?.(ctx.file)
                  ? 'Remove Knowledge Base'
                  : 'Set as Knowledge Base'}
              </button>
            </Show>
            <Show when={!ctx.file.isVirtual || canVirtual('download')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onDownload(ctx.file)
                  props.onDismiss()
                }}
              >
                {downloadLabel()}
              </button>
            </Show>
            <Show when={showCopyTo()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onCopy?.(ctx.file)
                  props.onDismiss()
                }}
              >
                Copy to...
              </button>
            </Show>
            <Show when={showEditSeparator()}>
              <div class='bg-border my-1 h-px' role='separator' />
            </Show>
            <Show when={showMove()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onMove?.(ctx.file)
                  props.onDismiss()
                }}
              >
                Move to...
              </button>
            </Show>
            <Show when={showRename()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onRename?.(ctx.file)
                  props.onDismiss()
                }}
              >
                Rename
              </button>
            </Show>
            <Show when={showDeleteFile()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='text-destructive flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => props.onDelete(ctx.file)}
              >
                Delete
              </button>
            </Show>
          </>
        )
      }}
    </FloatingContextMenu>
  )
}
