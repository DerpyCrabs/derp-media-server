import { NativeFileMenu } from '@/desktop/NativeOpen'
import { view } from 'effectweb'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { Button } from '@/lib/ui/button'
import { type MenuEntry } from '@/lib/ui/menu'
import { isPathEditable } from '@/lib/files/path-utils'
import type { FileTools } from './file-tools-controller'
import type { FileBrowserHost } from './FileBrowser'
export const FileToolsMenu = view<{
  tools: FileTools
  state: ReturnType<FileTools['read']>
  host: FileBrowserHost
  onCreateFolder: () => void
  onCreateFile: () => void
}>((props) => {
  const { tools, state, host } = props
  const selected = state.selected
  const writable =
    selected.length > 0 &&
    selected.every((path) => isPathEditable(path, host.editableFolders, host.mediaRoots))
  const editable = isPathEditable(host.currentPath, host.editableFolders, host.mediaRoots)
  const items: MenuEntry[] = [
    ...(editable
      ? [
          { kind: 'item' as const, label: 'New folder', onSelect: props.onCreateFolder },
          { kind: 'item' as const, label: 'New file', onSelect: props.onCreateFile },
          { kind: 'separator' as const },
        ]
      : []),
    {
      kind: 'item',
      label: state.selecting ? 'End selection' : 'Select files',
      onSelect: tools.selectMode,
    },
    { kind: 'item', label: 'Select all', shortcut: 'Ctrl/⌘ A', onSelect: tools.selectAll },
    {
      kind: 'item',
      label: 'Edit location',
      shortcut: 'Ctrl/⌘ L',
      onSelect: () => tools.open('location'),
    },
    { kind: 'item', label: 'Filter folder', shortcut: 'Ctrl/⌘ F', onSelect: tools.openFilter },
    {
      kind: 'checkbox',
      label: 'Hidden files',
      checked: state.hidden,
      onCheckedChange: tools.toggleHidden,
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Paste',
      shortcut: 'Ctrl/⌘ V',
      disabled: !editable || (!state.jobs.clipboard && !state.desktop),
      onSelect: tools.paste,
    },
    ...(selected.length
      ? [
          {
            kind: 'item' as const,
            label: 'Copy',
            shortcut: 'Ctrl/⌘ C',
            onSelect: () => tools.copy(false),
          },
          {
            kind: 'item' as const,
            label: 'Cut',
            shortcut: 'Ctrl/⌘ X',
            disabled: !writable,
            onSelect: () => tools.copy(true),
          },
          {
            kind: 'item' as const,
            label: 'Copy to…',
            disabled: !host.editableFolders.length,
            onSelect: () => tools.open('copy'),
          },
          {
            kind: 'item' as const,
            label: 'Move to…',
            disabled: !writable,
            onSelect: () => tools.open('move'),
          },
          {
            kind: 'item' as const,
            label: state.trashAvailable ? 'Move to trash' : 'Delete…',
            disabled: !writable,
            onSelect: () => tools.open('delete'),
          },
          { kind: 'separator' as const },
          {
            kind: 'item' as const,
            label: 'Create archive…',
            disabled: !host.editableFolders.length,
            onSelect: () => tools.open('createArchive'),
          },
          ...(selected.length === 1
            ? [
                {
                  kind: 'item' as const,
                  label: 'Properties',
                  onSelect: () => tools.open('properties'),
                },
              ]
            : []),
        ]
      : []),
    { kind: 'separator' },
    { kind: 'item', label: 'File operations', onSelect: () => tools.open('operations') },
    ...(state.desktop
      ? [
          {
            kind: 'item' as const,
            label: 'Open terminal here',
            onSelect: () => tools.openTerminal(),
          },
        ]
      : []),
  ]
  return (
    <NativeFileMenu
      path={selected.length === 1 ? selected[0] : undefined}
      align='end'
      aria-label='File actions'
      trigger={
        <Button
          variant='ghost'
          size='icon'
          aria-label='File actions'
          data-selected-count={selected.length}
          title={selected.length ? `${selected.length} selected` : 'File actions'}
        >
          <Ellipsis />
        </Button>
      }
      items={items}
    />
  )
})
