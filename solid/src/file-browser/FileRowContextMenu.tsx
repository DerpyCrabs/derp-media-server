import type { FileItem } from '@/lib/types'
import { isPathEditable } from '@/lib/utils'
import BookOpen from 'lucide-solid/icons/book-open'
import ExternalLink from 'lucide-solid/icons/external-link'
import Link from 'lucide-solid/icons/link'
import Pencil from 'lucide-solid/icons/pencil'
import Pin from 'lucide-solid/icons/pin'
import type { Accessor } from 'solid-js'
import { createEffect, onCleanup, Show } from 'solid-js'

type MenuState = { x: number; y: number; file: FileItem }

type FileRowContextMenuProps = {
  menu: Accessor<MenuState | null>
  editableFolders: Accessor<string[]>
  isCurrentDirEditable: Accessor<boolean>
  hasEditableFolders: Accessor<boolean>
  onDismiss: () => void
  onDownload: (file: FileItem) => void
  onDelete: (file: FileItem) => void
  onShare?: (file: FileItem) => void
  onCopyShareLink?: (file: FileItem) => void
  getPathHasShare?: (file: FileItem) => boolean
  onAddToTaskbar?: (file: FileItem) => void
  onOpenInNewTab?: (file: FileItem) => void
  onRename?: (file: FileItem) => void
  onMove?: (file: FileItem) => void
  onCopy?: (file: FileItem) => void
  onSetIcon?: (file: FileItem) => void
  onToggleKnowledgeBase?: (file: FileItem) => void
  isKnowledgeBase?: (file: FileItem) => boolean
}

export function FileRowContextMenu(props: FileRowContextMenuProps) {
  createEffect(() => {
    const ctx = props.menu()
    if (!ctx) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-slot="file-row-context-menu"]')) return
      props.onDismiss()
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  return (
    <Show when={props.menu()} keyed>
      {(ctx) => {
        const downloadLabel = () => (ctx.file.isDirectory ? 'Download as ZIP' : 'Download')
        const showRevokeShare = () => !!ctx.file.shareToken
        const showDeleteFile = () =>
          isPathEditable(ctx.file.path, props.editableFolders()) &&
          !ctx.file.isVirtual &&
          !ctx.file.shareToken
        const showShare = () => !ctx.file.isVirtual && !ctx.file.shareToken && !!props.onShare
        const showCopyShareLink = () => !!ctx.file.shareToken && !!props.onCopyShareLink
        const showCopyTo = () => props.hasEditableFolders() && !ctx.file.isVirtual && !!props.onCopy
        const showMove = () =>
          props.isCurrentDirEditable() &&
          !ctx.file.isVirtual &&
          !ctx.file.shareToken &&
          !!props.onMove
        const showRename = () =>
          props.isCurrentDirEditable() &&
          !ctx.file.isVirtual &&
          !ctx.file.shareToken &&
          !!props.onRename
        const showEditSeparator = () =>
          showRevokeShare() || showDeleteFile() || showMove() || showRename()
        const manageLabel = () => (props.getPathHasShare?.(ctx.file) ? 'Manage Share' : 'Share')

        return (
          <div
            data-no-window-drag
            data-slot='file-row-context-menu'
            class='fixed z-500000 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
            style={{ left: `${ctx.x}px`, top: `${ctx.y}px` }}
            role='menu'
          >
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
            <Show when={props.onOpenInNewTab && !ctx.file.isVirtual}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onOpenInNewTab?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <ExternalLink class='h-4 w-4 shrink-0' stroke-width={2} />
                Open in new tab
              </button>
            </Show>
            <Show when={props.onAddToTaskbar && !ctx.file.isVirtual}>
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
            <Show when={showShare()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onShare?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Link
                  class={`h-4 w-4 shrink-0 ${props.getPathHasShare?.(ctx.file) ? 'text-primary' : ''}`}
                  stroke-width={2}
                />
                {manageLabel()}
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
            <Show when={showCopyShareLink()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onCopyShareLink?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Link class='h-4 w-4 shrink-0' stroke-width={2} />
                Copy share link
              </button>
            </Show>
            <Show when={showEditSeparator()}>
              <div class='bg-border my-1 h-px' role='separator' />
            </Show>
            <Show when={showRevokeShare()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='text-destructive flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => props.onDelete(ctx.file)}
              >
                Revoke Share
              </button>
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
          </div>
        )
      }}
    </Show>
  )
}
