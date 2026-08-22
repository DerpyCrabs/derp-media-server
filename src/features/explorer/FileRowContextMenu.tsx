import type { FileItem } from '@/lib/files/types'
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
import { Show, createSignal } from 'solid-js'
import type { VirtualCapability } from '@/lib/files/virtual-directory'
import type { ExplorerRowMenu } from './explorer-row-menu'

type MenuState = { x: number; y: number; file: FileItem }

export function FileRowContextMenu(props: { model: ExplorerRowMenu }) {
  const [openWithState, setOpenWithState] = createSignal<{
    menu: MenuState | null
    open: boolean
  }>({ menu: null, open: false })
  const openWithOpen = () => {
    const state = openWithState()
    return state.menu === props.model.menu() && state.open
  }
  const setOpenWithOpen = (open: boolean) => setOpenWithState({ menu: props.model.menu(), open })

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
            <Show when={canVirtual('rename')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('rename', ctx.file)}
              >
                Rename
              </button>
            </Show>
            <Show when={canVirtual('branch')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('branch', ctx.file)}
              >
                Branch
              </button>
            </Show>
            <Show when={canVirtual('moveToProject')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('moveToProject', ctx.file)}
              >
                Move to project…
              </button>
            </Show>
            <Show when={canVirtual('copyId')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('copyId', ctx.file)}
              >
                Copy session ID
              </button>
            </Show>
            <Show when={canVirtual('addProjectFolder')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('addProjectFolder', ctx.file)}
              >
                Add gateway directory…
              </button>
            </Show>
            <Show when={canVirtual('removeProjectFolder')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('removeProjectFolder', ctx.file)}
              >
                Remove gateway directory…
              </button>
            </Show>
            <Show when={canVirtual('setPrimaryFolder')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('setPrimaryFolder', ctx.file)}
              >
                Set primary directory…
              </button>
            </Show>
            <Show when={canVirtual('setAppearance')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('setAppearance', ctx.file)}
              >
                Appearance…
              </button>
            </Show>
            <Show when={canVirtual('archive')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('archive', ctx.file)}
              >
                Archive
              </button>
            </Show>
            <Show when={canVirtual('restore')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('restore', ctx.file)}
              >
                Restore
              </button>
            </Show>
            <Show when={canVirtual('deleteProject')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('deleteProject', ctx.file)}
              >
                Delete Project
              </button>
            </Show>
            <Show when={canVirtual('deletePermanently')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='text-destructive flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                onClick={() => props.model.runVirtual('deletePermanently', ctx.file)}
              >
                Delete Permanently
              </button>
            </Show>
            <Show when={available('set-icon')}>
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
            </Show>
            <Show when={available('pick-new-tab-target')}>
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
            </Show>
            <Show when={available('primary-open')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => props.model.run('primary-open', ctx.file)}
              >
                <Show
                  when={props.model.primaryOpenUsesNewWindow(ctx.file)}
                  fallback={<ExternalLink class='h-4 w-4 shrink-0' stroke-width={2} />}
                >
                  <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                </Show>
                {props.model.label('primary-open', ctx.file)}
              </button>
            </Show>
            <Show when={available('split-view')}>
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
            </Show>
            <Show when={available('open-with')}>
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
                </Show>
              </div>
            </Show>
            <Show when={available('other-surface')}>
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
            </Show>
            <Show when={available('add-to-taskbar')}>
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
            </Show>
            <Show when={available('favorite')}>
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
            </Show>
            <Show when={available('knowledge-base')}>
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
            </Show>
            <Show when={available('download')}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => props.model.run('download', ctx.file)}
              >
                {props.model.label('download', ctx.file)}
              </button>
            </Show>
            <Show when={showCopyTo()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => props.model.run('copy', ctx.file)}
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
                onClick={() => props.model.run('move', ctx.file)}
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
                onClick={() => props.model.run('rename', ctx.file)}
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
                onClick={() => props.model.run('delete', ctx.file)}
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
