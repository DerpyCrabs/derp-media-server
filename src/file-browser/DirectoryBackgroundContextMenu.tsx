import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import type { Accessor } from 'solid-js'
import type { ExplorerCapability } from '@/lib/explorer-model'
import { Show } from 'solid-js'
import { FloatingContextMenu } from './FloatingContextMenu'

export type DirectoryBackgroundMenuState = { x: number; y: number }

type Props = {
  menu: Accessor<DirectoryBackgroundMenuState | null>
  capabilities: Accessor<readonly ExplorerCapability[]>
  onDismiss: () => void
  onNewFile: () => void
  onNewFolder: () => void
}

export function DirectoryBackgroundContextMenu(props: Props) {
  return (
    <FloatingContextMenu
      state={props.menu}
      anchor={(ctx) => ({ x: ctx.x, y: ctx.y })}
      onDismiss={props.onDismiss}
      data-slot='directory-background-context-menu'
      data-testid='directory-background-context-menu'
    >
      {() => (
        <>
          <Show when={props.capabilities().includes('createFile')}>
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='directory-bg-menu-new-file'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onNewFile()
                props.onDismiss()
              }}
            >
              <FilePlus class='h-4 w-4 shrink-0' stroke-width={2} />
              New file
            </button>
          </Show>
          <Show when={props.capabilities().includes('createFolder')}>
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='directory-bg-menu-new-folder'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onNewFolder()
                props.onDismiss()
              }}
            >
              <FolderPlus class='h-4 w-4 shrink-0' stroke-width={2} />
              New folder
            </button>
          </Show>
        </>
      )}
    </FloatingContextMenu>
  )
}
