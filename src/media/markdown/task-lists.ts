import { EditorView, WidgetType } from '@codemirror/view'

import type { MarkdownMode } from './types'

export function toggledTaskMarker(marker: string): string | null {
  if (!/^\[[ xX]\]$/.test(marker)) return null
  return marker[1] === ' ' ? '[x]' : '[ ]'
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly markerFrom: number,
    readonly marker: string,
    readonly mode: MarkdownMode,
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return (
      other.markerFrom === this.markerFrom &&
      other.marker === this.marker &&
      other.mode === this.mode
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'cm-md-task-checkbox'
    checkbox.checked = this.marker[1]?.toLowerCase() === 'x'
    checkbox.disabled = this.mode === 'read'
    checkbox.tabIndex = this.mode === 'read' ? -1 : 0
    checkbox.dataset.markdownTask = this.mode
    checkbox.setAttribute('aria-label', checkbox.checked ? 'Completed task' : 'Open task')
    checkbox.addEventListener('change', (event) => {
      event.stopPropagation()
      if (this.mode !== 'edit') return
      view.dispatch({
        changes: {
          from: this.markerFrom + 1,
          to: this.markerFrom + 2,
          insert: checkbox.checked ? 'x' : ' ',
        },
        userEvent: 'input.markdown.task',
      })
      view.focus()
    })
    return checkbox
  }

  ignoreEvent(): boolean {
    return true
  }
}
