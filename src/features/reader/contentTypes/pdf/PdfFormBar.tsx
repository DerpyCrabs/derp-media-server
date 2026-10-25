import { domBinding, observe, view } from 'effectweb'
import { SaveFileDialog } from '@/features/explorer/SaveFileDialog'
import type { PdfForms } from './pdf-forms'
const button =
  'rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40'
const saveShortcut = (element: HTMLDivElement, current: () => PdfForms) => {
  const handler = (event: KeyboardEvent) => {
    const root = element.closest('[data-testid="reader-dialog"]')
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 's' &&
      root?.contains(event.target as Node)
    ) {
      event.preventDefault()
      current().openSave()
    }
  }
  document.addEventListener('keydown', handler)
  return {
    update: () => undefined,
    dispose: () => document.removeEventListener('keydown', handler),
  }
}
export const PdfFormBar = view<{ forms: PdfForms; path: string; embedded?: boolean }>(
  ({ forms, path, embedded }) =>
    observe(forms.source, (state) => (
      <div
        use={domBinding(forms, saveShortcut)}
        class='border-b border-white/10 bg-[#202020] px-3 py-2 text-xs text-white'
      >
        <div class='flex flex-wrap items-center gap-2'>
          <span class='mr-auto text-white/70'>
            {state.dirty
              ? state.draftSaved
                ? 'Form entries backed up in this browser'
                : 'Unsaved form entries'
              : state.savedPath
                ? `Saved copy: ${state.savedPath}`
                : 'Fillable PDF'}
          </span>
          <button
            type='button'
            class={button}
            disabled={state.pending}
            onClick={forms.openSave}
            title='Save a filled copy (Ctrl/Cmd+S)'
          >
            Save copy…
          </button>
        </div>
        {state.drafts[0] ? (
          <div class='mt-2 flex flex-wrap items-center gap-2' role='status'>
            <span>
              {forms.compatible(state.drafts[0])
                ? 'Recover saved form entries?'
                : 'Saved form entries belong to a different version of this PDF.'}
            </span>
            {forms.compatible(state.drafts[0]) ? (
              <button
                type='button'
                class={button}
                disabled={state.dirty || state.pending}
                onClick={forms.restore}
              >
                Restore entries
              </button>
            ) : null}
            <button type='button' class={button} onClick={forms.downloadDraft}>
              Download entries
            </button>
            <button type='button' class={button} onClick={forms.discardDraft}>
              Discard saved entries
            </button>
          </div>
        ) : null}
        {state.draftError ? (
          <p role='alert' class='mt-1 text-amber-300'>
            {state.draftError}
          </p>
        ) : null}
        {state.error && !state.saveDialog ? (
          <p role='alert' class='mt-1 text-red-300'>
            {state.error}
          </p>
        ) : null}
        {state.saveDialog ? (
          <SaveFileDialog
            title='Save filled PDF copy'
            suggestedPath={path.replace(/\.pdf$/i, '-filled.pdf')}
            editableFolders={state.editableFolders}
            description='Save an editable copy with the current form entries. The original stays unchanged.'
            pending={state.pending}
            error={state.error}
            overlayScope={embedded ? 'window' : 'viewport'}
            onConfirm={forms.save}
            onDownload={forms.download}
            onClose={forms.closeSave}
          />
        ) : null}
      </div>
    )),
)
