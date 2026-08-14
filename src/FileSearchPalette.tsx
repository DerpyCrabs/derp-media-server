import FileSearch from 'lucide-solid/icons/file-search'
import { Show, createSignal } from 'solid-js'
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchHit,
} from './features/search/contracts'
import { SearchPalette } from './features/search/SearchPalette'
import { applicationSearchCoordinator } from './integrations/search'

export type FileSearchButtonProps = {
  title: string
  onSelect: (result: SearchHit) => void
  disabled?: boolean
  class?: string
  iconClass?: string
  testId?: string
}

export function FileSearchButton(props: FileSearchButtonProps) {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <button
        type='button'
        class={
          props.class ??
          'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
        }
        title={props.title}
        aria-label={props.title}
        disabled={props.disabled}
        data-testid={props.testId}
        onClick={() => setOpen(true)}
      >
        <FileSearch class={props.iconClass ?? 'size-4'} aria-hidden='true' stroke-width={2} />
      </button>
      <Show when={open()}>
        <FileSearchPalette
          title={props.title}
          onClose={() => setOpen(false)}
          onSelect={props.onSelect}
        />
      </Show>
    </>
  )
}

function FileSearchPalette(props: {
  title: string
  onClose: () => void
  onSelect: (result: SearchHit) => void
}) {
  return (
    <SearchPalette
      search={{
        coordinator: applicationSearchCoordinator,
        minimumQueryLength: SEARCH_MIN_QUERY_LENGTH,
        limit: SEARCH_DEFAULT_LIMIT,
      }}
      title={props.title}
      testId='file-search-palette'
      placeholder='Search files and folders…'
      onClose={props.onClose}
      onSelect={props.onSelect}
      chrome={{
        overlayClass:
          'fixed inset-0 z-[1100000] flex items-end justify-center bg-black/55 sm:items-start sm:px-4 sm:pt-[12vh]',
        dialogClass: 'max-h-[92dvh] rounded-t-2xl sm:max-h-[72vh] sm:max-w-2xl sm:rounded-xl',
        resultsClass: 'min-h-48',
        resultCountLimit: SEARCH_DEFAULT_LIMIT,
      }}
      messages={{
        idle: `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters to search every media directory.`,
        empty: 'No matching files or folders.',
        showErrors: true,
      }}
      result={{
        detail: (result) => result.detail ?? result.snippet ?? result.contributorLabel,
        badge: (result) => result.group ?? result.contributorLabel,
      }}
    />
  )
}
