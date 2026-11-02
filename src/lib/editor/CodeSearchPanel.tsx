import { modelOwner, mount, view } from 'effectweb'
import type { EditorView, Panel, ViewUpdate } from '@codemirror/view'
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
  closeSearchPanel,
} from '@codemirror/search'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import X from '@effectweb/lucide/icons/x'
import { Button } from '@/lib/ui/button'
import { Input } from '@/lib/ui/input'
import { DropdownMenu } from '@/lib/ui/menu'

type SearchState = {
  query: SearchQuery
  replacing: boolean
  readOnly: boolean
  change: (change: Partial<SearchQuery>) => void
  toggleReplace: () => void
  next: () => void
  previous: () => void
  replace: () => void
  replaceAll: () => void
  selectAll: () => void
  close: () => void
}
const SearchBar = view<SearchState>((state) => (
  <div
    class='space-y-1 p-1.5'
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        state.close()
      }
    }}
  >
    <div class='flex items-center gap-1'>
      {!state.readOnly ? (
        <Button
          variant='ghost'
          size='icon'
          aria-label='Toggle replace'
          aria-expanded={state.replacing}
          onClick={state.toggleReplace}
        >
          {state.replacing ? <ChevronDown /> : <ChevronRight />}
        </Button>
      ) : null}
      <Input
        class='min-w-0 flex-1'
        aria-label='Find'
        placeholder='Find'
        main-field='true'
        value={state.query.search}
        aria-invalid={!state.query.valid && !!state.query.search}
        onInput={(event) => state.change({ search: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            ;(event.shiftKey ? state.previous : state.next)()
          }
        }}
      />
      <Button variant='ghost' size='icon' aria-label='Previous match' onClick={state.previous}>
        <ArrowUp />
      </Button>
      <Button variant='ghost' size='icon' aria-label='Next match' onClick={state.next}>
        <ArrowDown />
      </Button>
      <DropdownMenu
        aria-label='Search options'
        align='end'
        trigger={
          <Button variant='ghost' size='icon' aria-label='Search options'>
            <Ellipsis />
          </Button>
        }
        items={[
          {
            kind: 'checkbox',
            label: 'Match case',
            checked: state.query.caseSensitive,
            onCheckedChange: (caseSensitive) => state.change({ caseSensitive }),
          },
          {
            kind: 'checkbox',
            label: 'Whole words',
            checked: state.query.wholeWord,
            onCheckedChange: (wholeWord) => state.change({ wholeWord }),
          },
          {
            kind: 'checkbox',
            label: 'Regular expression',
            checked: state.query.regexp,
            onCheckedChange: (regexp) => state.change({ regexp }),
          },
          { kind: 'separator' },
          { kind: 'item', label: 'Select all matches', onSelect: state.selectAll },
        ]}
      />
      <Button variant='ghost' size='icon' aria-label='Close search' onClick={state.close}>
        <X />
      </Button>
    </div>
    {state.replacing && !state.readOnly ? (
      <div class='flex items-center gap-1 pl-9'>
        <Input
          class='min-w-0 flex-1'
          aria-label='Replace'
          placeholder='Replace'
          value={state.query.replace}
          onInput={(event) => state.change({ replace: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              state.replace()
            }
          }}
        />
        <Button variant='outline' onClick={state.replace}>
          Replace
        </Button>
        <Button variant='outline' onClick={state.replaceAll}>
          Replace all
        </Button>
      </div>
    ) : null}
  </div>
))

export function createCodeSearchPanel(editor: EditorView): Panel {
  const dom = document.createElement('div')
  const owner = modelOwner<SearchState>({
    query: getSearchQuery(editor.state),
    replacing: false,
    readOnly: editor.state.readOnly,
    change: (change) => {
      const current = getSearchQuery(editor.state)
      const query = new SearchQuery({
        search: current.search,
        replace: current.replace,
        caseSensitive: current.caseSensitive,
        regexp: current.regexp,
        wholeWord: current.wholeWord,
        ...change,
      })
      editor.dispatch({ effects: setSearchQuery.of(query) })
    },
    toggleReplace: () => owner.patch({ replacing: !owner.read().replacing }),
    next: () => {
      findNext(editor)
    },
    previous: () => {
      findPrevious(editor)
    },
    replace: () => {
      replaceNext(editor)
    },
    replaceAll: () => {
      replaceAll(editor)
    },
    selectAll: () => {
      selectMatches(editor)
    },
    close: () => {
      closeSearchPanel(editor)
      editor.focus()
    },
  })
  const rendered = mount(dom, SearchBar, owner.source)
  return {
    dom,
    top: true,
    mount: () => {
      const input = dom.querySelector('input')
      input?.focus()
      input?.select()
    },
    update: (update: ViewUpdate) =>
      owner.patch({ query: getSearchQuery(update.state), readOnly: update.state.readOnly }),
    destroy: () => {
      rendered.dispose()
      owner.dispose()
    },
  }
}
