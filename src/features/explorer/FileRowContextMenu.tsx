import { type Snapshot, component, view } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import { FloatingContextMenu } from './FloatingContextMenu'
import AppWindow from '@effectweb/lucide/icons/app-window'
import BookOpen from '@effectweb/lucide/icons/book-open'
import Columns2 from '@effectweb/lucide/icons/columns-2'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import ExternalLink from '@effectweb/lucide/icons/external-link'
import FolderOpen from '@effectweb/lucide/icons/folder-open'
import Pencil from '@effectweb/lucide/icons/pencil'
import Pin from '@effectweb/lucide/icons/pin'
import Settings from '@effectweb/lucide/icons/settings'
import Library from '@effectweb/lucide/icons/library'
import Star from '@effectweb/lucide/icons/star'
import type { VirtualCapability } from '@/lib/files/virtual-directory'
import type { ExplorerRowMenu } from './explorer-row-menu'
type MenuState = { x: number; y: number; file: FileItem }
export const FileRowContextMenu = component(
  {
    init: (_props: Snapshot<{ model: ExplorerRowMenu }>) => ({
      openWithState: { menu: null, open: false } as { menu: MenuState | null; open: boolean },
    }),
  },
  view((local, patch) => {
    const props = local.props
    const openWithState = () => local.openWithState
    const setOpenWithState = (value: { menu: MenuState | null; open: boolean }) =>
      patch({ openWithState: value })
    const openWithOpen = () => {
      const state = openWithState()
      return state.menu === props.model.menu && state.open
    }
    const setOpenWithOpen = (open: boolean) => setOpenWithState({ menu: props.model.menu, open })
    return (
      <FloatingContextMenu
        state={props.model.menu}
        anchor={(ctx) => ({ x: ctx.x, y: ctx.y })}
        onDismiss={props.model.dismiss}
        data-slot='file-row-context-menu'
      >
        {(ctx) => {
          const canVirtual = (capability: VirtualCapability) =>
            props.model.canVirtual(capability, ctx.file)
          const available = (action: Parameters<ExplorerRowMenu['available']>[0]) =>
            props.model.available(action, ctx.file)
          const showEditSeparator = () => showDeleteFile() || showMove() || showRename()
          const showDeleteFile = () => available('delete')
          const showCopyTo = () => available('copy')
          const showMove = () => available('move')
          const showRename = () => available('rename')
          return (
            <>
              {canVirtual('rename') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('rename', ctx.file)}
                >
                  Rename
                </button>
              ) : null}
              {canVirtual('branch') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('branch', ctx.file)}
                >
                  Branch
                </button>
              ) : null}
              {canVirtual('moveToProject') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('moveToProject', ctx.file)}
                >
                  Move to project…
                </button>
              ) : null}
              {canVirtual('copyId') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('copyId', ctx.file)}
                >
                  Copy session ID
                </button>
              ) : null}
              {canVirtual('addProjectFolder') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('addProjectFolder', ctx.file)}
                >
                  Add gateway directory…
                </button>
              ) : null}
              {canVirtual('removeProjectFolder') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('removeProjectFolder', ctx.file)}
                >
                  Remove gateway directory…
                </button>
              ) : null}
              {canVirtual('setPrimaryFolder') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('setPrimaryFolder', ctx.file)}
                >
                  Set primary directory…
                </button>
              ) : null}
              {canVirtual('setAppearance') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('setAppearance', ctx.file)}
                >
                  Appearance…
                </button>
              ) : null}
              {canVirtual('archive') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('archive', ctx.file)}
                >
                  Archive
                </button>
              ) : null}
              {canVirtual('restore') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('restore', ctx.file)}
                >
                  Restore
                </button>
              ) : null}
              {canVirtual('deleteProject') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('deleteProject', ctx.file)}
                >
                  Delete Project
                </button>
              ) : null}
              {canVirtual('deletePermanently') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('deletePermanently', ctx.file)}
                >
                  Delete Permanently
                </button>
              ) : null}
              {available('set-icon') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('set-icon', ctx.file)}
                >
                  <Pencil class='h-4 w-4 shrink-0' stroke-width={2} />
                  Set icon
                </button>
              ) : null}
              {available('pick-new-tab-target') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-pick-new-tab-target'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  title='Choose which window receives files opened in a new tab'
                  onClick={() => props.model.run('pick-new-tab-target', ctx.file)}
                >
                  <Settings class='h-4 w-4 shrink-0' stroke-width={2} />
                  Choose where new tabs open…
                </button>
              ) : null}
              {available('primary-open') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('primary-open', ctx.file)}
                >
                  {props.model.primaryOpenUsesNewWindow(ctx.file) ? (
                    <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                  ) : (
                    <ExternalLink class='h-4 w-4 shrink-0' stroke-width={2} />
                  )}
                  {props.model.label('primary-open', ctx.file)}
                </button>
              ) : null}
              {available('split-view') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-file-menu-open-split-view'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('split-view', ctx.file)}
                >
                  <Columns2 class='h-4 w-4 shrink-0' stroke-width={2} />
                  Open in split view
                </button>
              ) : null}
              {available('open-with') ? (
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
                  {openWithOpen() ? (
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
                        onClick={() => props.model.run('open-with-browser', ctx.file)}
                      >
                        <FolderOpen class='h-4 w-4 shrink-0' stroke-width={2} />
                        Browser
                      </button>
                      <button
                        type='button'
                        role='menuitem'
                        data-testid='open-with-reader'
                        class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                        onClick={() => props.model.run('open-with-reader', ctx.file)}
                      >
                        <BookOpen class='h-4 w-4 shrink-0' stroke-width={2} />
                        Reader
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {available('other-surface') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('other-surface', ctx.file)}
                >
                  <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                  {props.model.label('other-surface', ctx.file)}
                </button>
              ) : null}
              {available('add-to-taskbar') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('add-to-taskbar', ctx.file)}
                >
                  <Pin class='h-4 w-4 shrink-0' stroke-width={2} />
                  Add to taskbar
                </button>
              ) : null}
              {available('favorite') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('favorite', ctx.file)}
                >
                  <Star
                    class={`h-4 w-4 shrink-0 ${props.model.active('favorite', ctx.file) ? 'fill-yellow-400 text-yellow-400' : ''}`}
                    stroke-width={2}
                  />
                  {props.model.label('favorite', ctx.file)}
                </button>
              ) : null}
              {available('knowledge-base') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('knowledge-base', ctx.file)}
                >
                  <BookOpen
                    class={`h-4 w-4 shrink-0 ${props.model.active('knowledge-base', ctx.file) ? 'fill-primary text-primary' : ''}`}
                    stroke-width={2}
                  />
                  {props.model.label('knowledge-base', ctx.file)}
                </button>
              ) : null}
              {available('download') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('download', ctx.file)}
                >
                  {props.model.label('download', ctx.file)}
                </button>
              ) : null}
              {available('copy-native') ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  role='menuitem'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.run('copy-native', ctx.file)}
                >
                  Copy
                </button>
              ) : null}
              {showCopyTo() ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('copy', ctx.file)}
                >
                  Copy to...
                </button>
              ) : null}
              {showEditSeparator() ? <div class='bg-border my-1 h-px' role='separator' /> : null}
              {showMove() ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('move', ctx.file)}
                >
                  Move to...
                </button>
              ) : null}
              {showRename() ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('rename', ctx.file)}
                >
                  Rename
                </button>
              ) : null}
              {showDeleteFile() ? (
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('delete', ctx.file)}
                >
                  Delete
                </button>
              ) : null}
            </>
          )
        }}
      </FloatingContextMenu>
    )
  }),
)
