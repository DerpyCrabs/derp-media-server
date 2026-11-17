import { restoreOverlayFocus } from './overlay-focus'
import {
  controllerView,
  list,
  modelOwner,
  ownerController,
  sequence,
  view,
  type JSX,
} from 'effectweb'
import { createMenu, menuAnchorBinding, nextIndex, type MenuHandle } from '@effectweb/base-ui'
import { cn } from './cn'
import type { DropdownMenuProps as LibraryMenuProps } from '@effectweb/shadcn/dropdown-menu'
type Align = LibraryMenuProps['align']
type Side = LibraryMenuProps['side']
import {
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuContent,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@effectweb/shadcn/dropdown-menu'
export type MenuEntry =
  | {
      readonly kind: 'item'
      readonly label: JSX.Element
      readonly onSelect: () => void
      readonly disabled?: boolean | undefined
      readonly variant?: 'default' | 'destructive' | undefined
      readonly inset?: boolean | undefined
      readonly shortcut?: string | undefined
      readonly icon?: JSX.Element
    }
  | {
      readonly kind: 'checkbox'
      readonly label: JSX.Element
      readonly checked: boolean
      readonly onCheckedChange: (checked: boolean) => void
      readonly disabled?: boolean | undefined
    }
  | { readonly kind: 'label'; readonly label: JSX.Element; readonly inset?: boolean | undefined }
  | { readonly kind: 'separator' }
  | {
      readonly kind: 'submenu'
      readonly label: JSX.Element
      readonly items: readonly MenuEntry[]
      readonly disabled?: boolean | undefined
    }
  | {
      readonly kind: 'radio'
      readonly label: JSX.Element
      readonly value: string
      readonly checked: boolean
      readonly onSelect: () => void
      readonly disabled?: boolean | undefined
    }

export interface DropdownMenuProps {
  readonly open?: boolean | undefined
  readonly defaultOpen?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  readonly trigger: JSX.Element
  readonly items: ReadonlyArray<MenuEntry>
  readonly side?: Side | undefined
  readonly align?: Align | undefined
  readonly sideOffset?: number | undefined
  readonly class?: string | undefined
  readonly 'aria-label'?: string | undefined
}

/** The item an arrow key moves focus to. */
export const nextMenuItem = (count: number, current: number, key: string): number | null =>
  nextIndex(count, current, key)
function menuController(props: DropdownMenuProps) {
  const owner = modelOwner({ props })
  const menu = createMenu({
    get open() {
      return owner.read().props.open
    },
    defaultOpen: props.defaultOpen,
    onOpenChange: (open) => owner.read().props.onOpenChange?.(open),
  })
  owner.own(menu.lifetime)
  return {
    source: owner.source,
    menu,
    lifetime: owner,
    receive: (next: DropdownMenuProps) => {
      owner.patch({ props: next })
      if (next.open !== undefined) menu.sync({ open: next.open })
    },
  }
}
type SubmenuProps = {
  readonly menu: MenuHandle
  readonly entry: Extract<MenuEntry, { kind: 'submenu' }>
}
function submenuController(props: SubmenuProps) {
  const owner = modelOwner({ props })
  const submenu = createMenu({ parent: props.menu })
  owner.own(submenu.lifetime)
  return { ...ownerController(owner), submenu }
}
const Submenu = controllerView(
  { controller: submenuController },
  view((model) => (
    <>
      <DropdownMenuSubTrigger
        menu={model.props.menu}
        submenu={model.actions.submenu}
        disabled={model.props.entry.disabled}
      >
        {model.props.entry.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        menu={model.actions.submenu}
        class='w-64 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto'
        finalFocus={() => restoreOverlayFocus(model.actions.submenu)}
      >
        <Entries menu={model.actions.submenu} items={model.props.entry.items} />
      </DropdownMenuSubContent>
    </>
  )),
)
type RadioEntry = Extract<MenuEntry, { kind: 'radio' }>
type EntryGroup =
  | Exclude<MenuEntry, RadioEntry>
  | { readonly kind: 'radios'; readonly items: readonly RadioEntry[] }
/** Adjacent radio entries form one independent selection group. */
function groupEntries(items: readonly MenuEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = []
  for (const entry of items) {
    const last = groups.at(-1)
    if (entry.kind !== 'radio') groups.push(entry)
    else if (last?.kind === 'radios')
      groups[groups.length - 1] = { kind: 'radios', items: [...last.items, entry] }
    else groups.push({ kind: 'radios', items: [entry] })
  }
  return groups
}
type RadioEntriesProps = { readonly menu: MenuHandle; readonly items: readonly RadioEntry[] }
const RadioEntries = controllerView(
  {
    controller: (props: RadioEntriesProps) => {
      const owner = modelOwner({ props })
      const value = () => owner.read().props.items.find((entry) => entry.checked)?.value ?? ''
      const menu = createMenu({
        parent: props.menu,
        get value() {
          return value()
        },
        onValueChange: (next) =>
          owner
            .read()
            .props.items.find((entry) => entry.value === next)
            ?.onSelect(),
      })
      owner.own(menu.lifetime)
      return {
        source: owner.source,
        menu,
        lifetime: owner,
        receive: (next: RadioEntriesProps) => {
          owner.patch({ props: next })
          menu.sync({ value: value() })
        },
      }
    },
  },
  view((model) => (
    <DropdownMenuRadioGroup>
      {list(
        model.props.items,
        (entry) => entry.value,
        (entry) => (
          <DropdownMenuRadioItem
            closeOnClick
            menu={model.actions.menu}
            value={entry.value}
            disabled={entry.disabled}
          >
            {entry.label}
          </DropdownMenuRadioItem>
        ),
      )}
    </DropdownMenuRadioGroup>
  )),
)
const Entries = view<{ readonly menu: MenuHandle; readonly items: readonly MenuEntry[] }>(
  (props) => (
    <>
      {list(sequence(groupEntries(props.items)), (entry) =>
        entry.kind === 'separator' ? (
          <DropdownMenuSeparator />
        ) : entry.kind === 'label' ? (
          <DropdownMenuLabel inset={entry.inset}>{entry.label}</DropdownMenuLabel>
        ) : entry.kind === 'submenu' ? (
          <Submenu menu={props.menu} entry={entry} />
        ) : entry.kind === 'radios' ? (
          <RadioEntries menu={props.menu} items={entry.items} />
        ) : entry.kind === 'checkbox' ? (
          <DropdownMenuCheckboxItem
            menu={props.menu}
            checked={entry.checked}
            onCheckedChange={entry.onCheckedChange}
            disabled={entry.disabled}
          >
            {entry.label}
          </DropdownMenuCheckboxItem>
        ) : (
          <DropdownMenuItem
            menu={props.menu}
            disabled={entry.disabled}
            inset={entry.inset}
            variant={entry.variant}
            onClick={entry.onSelect}
          >
            {entry.icon}
            {entry.label}
            {entry.shortcut ? (
              <DropdownMenuShortcut aria-hidden='true' class='hidden sm:inline'>
                {entry.shortcut}
              </DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ),
      )}
    </>
  ),
)
/** A menu whose controller is owned by this view. */
export const DropdownMenu = controllerView(
  { controller: menuController },
  view((model) => (
    <span
      data-slot='dropdown-menu'
      class='inline-block'
      use={menuAnchorBinding(model.actions.menu)}
      onClick={(event) => {
        if (event.currentTarget.firstElementChild?.contains(event.target as Node))
          model.actions.menu.toggle()
      }}
      onKeyDown={(event) => {
        if (
          event.currentTarget.firstElementChild?.contains(event.target as Node) &&
          (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
          event.preventDefault()
          model.actions.menu.openFromKey(event.key)
        }
      }}
    >
      {model.props.trigger}
      <DropdownMenuContent
        menu={model.actions.menu}
        finalFocus={() => restoreOverlayFocus(model.actions.menu)}
        side={model.props.side ?? 'bottom'}
        align={model.props.align ?? 'start'}
        sideOffset={model.props.sideOffset ?? 4}
        aria-label={model.props['aria-label']}
        data-slot='dropdown-menu-content'
        class={cn('w-64 max-w-[calc(100vw-1rem)]', model.props.class)}
      >
        <Entries menu={model.actions.menu} items={model.props.items} />
      </DropdownMenuContent>
    </span>
  )),
)
