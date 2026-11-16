import { NativeOpenButton } from '@/desktop/NativeOpen'
import { MenuItem } from '@/lib/ui/menu-item'
import { component, view } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import { FloatingContextMenu } from './FloatingContextMenu'
import { FLOATING_Z_CONTEXT_MENU } from '@/lib/ui/floating-z-index'
import Info from '@effectweb/lucide/icons/info'
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
    init: (_props: { model: ExplorerRowMenu }) => ({
      openWithState: { menu: null, open: false, anchor: null, focusFirstItem: false } as {
        menu: MenuState | null
        open: boolean
        anchor: HTMLElement | null
        focusFirstItem: boolean
      },
    }),
  },
  view((local, patch) => {
    const props = local.props
    const openWithState = () => local.openWithState
    const setOpenWithState = (value: {
      menu: MenuState | null
      open: boolean
      anchor: HTMLElement | null
      focusFirstItem: boolean
    }) => patch({ openWithState: value })
    const openWithOpen = () => {
      const state = openWithState()
      return state.menu === props.model.menu && state.open
    }
    const setOpenWithOpen = (
      open: boolean,
      anchor = openWithState().anchor,
      focusFirstItem = false,
    ) => setOpenWithState({ menu: props.model.menu, open, anchor, focusFirstItem })
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
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('rename', ctx.file)}
                >
                  Rename
                </MenuItem>
              ) : null}
              {canVirtual('branch') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('branch', ctx.file)}
                >
                  Branch
                </MenuItem>
              ) : null}
              {canVirtual('moveToProject') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('moveToProject', ctx.file)}
                >
                  Move to project…
                </MenuItem>
              ) : null}
              {canVirtual('copyId') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('copyId', ctx.file)}
                >
                  Copy session ID
                </MenuItem>
              ) : null}
              {canVirtual('addProjectFolder') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('addProjectFolder', ctx.file)}
                >
                  Add gateway directory…
                </MenuItem>
              ) : null}
              {canVirtual('removeProjectFolder') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('removeProjectFolder', ctx.file)}
                >
                  Remove gateway directory…
                </MenuItem>
              ) : null}
              {canVirtual('setPrimaryFolder') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('setPrimaryFolder', ctx.file)}
                >
                  Set primary directory…
                </MenuItem>
              ) : null}
              {canVirtual('setAppearance') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('setAppearance', ctx.file)}
                >
                  Appearance…
                </MenuItem>
              ) : null}
              {canVirtual('archive') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('archive', ctx.file)}
                >
                  Archive
                </MenuItem>
              ) : null}
              {canVirtual('restore') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('restore', ctx.file)}
                >
                  Restore
                </MenuItem>
              ) : null}
              {canVirtual('deleteProject') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('deleteProject', ctx.file)}
                >
                  Delete Project
                </MenuItem>
              ) : null}
              {canVirtual('deletePermanently') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.runVirtual('deletePermanently', ctx.file)}
                >
                  Delete Permanently
                </MenuItem>
              ) : null}
              {!ctx.file.isVirtual && !available('open-with') ? (
                <NativeOpenButton
                  path={ctx.file.path}
                  role='menuitem'
                  onDone={props.model.dismiss}
                />
              ) : null}
              {available('set-icon') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('set-icon', ctx.file)}
                >
                  <Pencil class='size-4 shrink-0' stroke-width={2} />
                  Set icon
                </MenuItem>
              ) : null}
              {available('pick-new-tab-target') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-pick-new-tab-target'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  title='Choose which window receives files opened in a new tab'
                  onClick={() => props.model.run('pick-new-tab-target', ctx.file)}
                >
                  <Settings class='size-4 shrink-0' stroke-width={2} />
                  Choose where new tabs open…
                </MenuItem>
              ) : null}
              {available('primary-open') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('primary-open', ctx.file)}
                >
                  {props.model.primaryOpenUsesNewWindow(ctx.file) ? (
                    <AppWindow class='size-4 shrink-0' stroke-width={2} />
                  ) : (
                    <ExternalLink class='size-4 shrink-0' stroke-width={2} />
                  )}
                  {props.model.label('primary-open', ctx.file)}
                </MenuItem>
              ) : null}
              {available('split-view') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-file-menu-open-split-view'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('split-view', ctx.file)}
                >
                  <Columns2 class='size-4 shrink-0' stroke-width={2} />
                  Open in split view
                </MenuItem>
              ) : null}
              {available('open-with') ? (
                <div class='relative'>
                  <MenuItem
                    variant='ghost'
                    type='button'
                    data-slot='context-menu-item'
                    data-testid='open-with-menu'
                    aria-haspopup='menu'
                    aria-expanded={openWithOpen() ? 'true' : 'false'}
                    class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                    role='menuitem'
                    onPointerEnter={(event) => setOpenWithOpen(true, event.currentTarget)}
                    onClick={(event) =>
                      setOpenWithOpen(true, event.currentTarget, event.detail === 0)
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight') {
                        event.preventDefault()
                        setOpenWithOpen(true, event.currentTarget, true)
                      }
                    }}
                  >
                    <Library class='size-4 shrink-0' stroke-width={2} />
                    <span class='flex-1 text-left'>Open with...</span>
                    <ChevronRight class='size-4 shrink-0' stroke-width={2} />
                  </MenuItem>
                  {openWithOpen() ? (
                    <FloatingContextMenu
                      open={openWithOpen()}
                      anchorRef={openWithState().anchor}
                      focusFirstItem={openWithState().focusFirstItem}
                      side='right'
                      class='w-56'
                      gap={0}
                      zIndex={FLOATING_Z_CONTEXT_MENU + 1}
                      onDismiss={() => setOpenWithOpen(false)}
                      data-testid='open-with-submenu'
                    >
                      <MenuItem
                        variant='ghost'
                        type='button'
                        role='menuitem'
                        data-testid='open-with-browser'
                        class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                        onClick={() => props.model.run('open-with-browser', ctx.file)}
                      >
                        <FolderOpen class='size-4 shrink-0' stroke-width={2} />
                        Browser
                      </MenuItem>
                      <MenuItem
                        variant='ghost'
                        type='button'
                        role='menuitem'
                        data-testid='open-with-reader'
                        class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                        onClick={() => props.model.run('open-with-reader', ctx.file)}
                      >
                        <BookOpen class='size-4 shrink-0' stroke-width={2} />
                        Reader
                      </MenuItem>
                      <NativeOpenButton
                        path={ctx.file.path}
                        chooserLabel='Installed application…'
                        onDone={props.model.dismiss}
                      />
                    </FloatingContextMenu>
                  ) : null}
                </div>
              ) : null}
              {available('other-surface') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('other-surface', ctx.file)}
                >
                  <AppWindow class='size-4 shrink-0' stroke-width={2} />
                  {props.model.label('other-surface', ctx.file)}
                </MenuItem>
              ) : null}
              {available('add-to-taskbar') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('add-to-taskbar', ctx.file)}
                >
                  <Pin class='size-4 shrink-0' stroke-width={2} />
                  Add to taskbar
                </MenuItem>
              ) : null}
              {available('sidebar') ? (
                <MenuItem onClick={() => props.model.run('sidebar', ctx.file)}>
                  {props.model.label('sidebar', ctx.file)}
                </MenuItem>
              ) : null}
              {available('favorite') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('favorite', ctx.file)}
                >
                  <Star
                    class={`size-4 shrink-0 ${props.model.active('favorite', ctx.file) ? 'fill-yellow-400 text-yellow-400' : ''}`}
                    stroke-width={2}
                  />
                  {props.model.label('favorite', ctx.file)}
                </MenuItem>
              ) : null}
              {available('knowledge-base') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('knowledge-base', ctx.file)}
                >
                  <BookOpen
                    class={`size-4 shrink-0 ${props.model.active('knowledge-base', ctx.file) ? 'fill-primary text-primary' : ''}`}
                    stroke-width={2}
                  />
                  {props.model.label('knowledge-base', ctx.file)}
                </MenuItem>
              ) : null}
              {available('download') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('download', ctx.file)}
                >
                  {props.model.label('download', ctx.file)}
                </MenuItem>
              ) : null}
              {available('copy-native') ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  role='menuitem'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                  onClick={() => props.model.run('copy-native', ctx.file)}
                >
                  Copy
                </MenuItem>
              ) : null}
              {showCopyTo() ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('copy', ctx.file)}
                >
                  Copy to...
                </MenuItem>
              ) : null}
              {showEditSeparator() ? <div class='bg-border my-1 h-px' role='separator' /> : null}
              {showMove() ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('move', ctx.file)}
                >
                  Move to...
                </MenuItem>
              ) : null}
              {showRename() ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('rename', ctx.file)}
                >
                  Rename
                </MenuItem>
              ) : null}
              {showDeleteFile() ? (
                <MenuItem
                  variant='ghost'
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => props.model.run('delete', ctx.file)}
                >
                  {props.model.label('delete', ctx.file)}
                </MenuItem>
              ) : null}
              {available('properties') ? (
                <>
                  <div class='my-1 h-px bg-border' role='separator' />
                  <MenuItem
                    variant='ghost'
                    type='button'
                    role='menuitem'
                    data-slot='context-menu-item'
                    class='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                    onClick={() => props.model.run('properties', ctx.file)}
                  >
                    <Info class='size-4' />
                    Properties
                  </MenuItem>
                </>
              ) : null}
            </>
          )
        }}
      </FloatingContextMenu>
    )
  }),
)
