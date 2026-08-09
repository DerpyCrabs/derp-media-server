import {
  createEmptyCanvasState,
  parseInfiniteCanvasState,
  type CanvasCard,
  type CanvasRect,
  type InfiniteCanvasState,
} from './infinite-canvas'

export const CANVAS_SNAPSHOTS_STORAGE_KEY = 'infinite-canvas-snapshots-v1'

export type CanvasTemplateKey = 'blank' | 'project' | 'reading' | 'hardware' | 'prompt'

export const CANVAS_TEMPLATES: Array<{
  key: CanvasTemplateKey
  label: string
  description: string
}> = [
  { key: 'blank', label: 'Blank', description: 'Empty workspace' },
  { key: 'project', label: 'Project', description: 'Brief, design, decisions, actions' },
  { key: 'reading', label: 'Reading', description: 'Sources, notes, synthesis' },
  { key: 'hardware', label: 'Hardware', description: 'Requirements, interfaces, validation' },
  { key: 'prompt', label: 'Prompting', description: 'Context, prompt brief, output review' },
]

export type CanvasSnapshot = {
  id: string
  canvasId: string
  name: string
  createdAt: number
  state: InfiniteCanvasState
}

export type CanvasExportBundle = {
  kind: 'derp-canvas'
  version: 1
  name: string
  exportedAt: number
  state: InfiniteCanvasState
}

function templateNote(
  id: number,
  title: string,
  body: string,
  color: string,
  bounds: CanvasRect,
): CanvasCard {
  return {
    id: `canvas-card-${id}`,
    kind: 'note',
    title,
    body,
    url: null,
    color,
    bounds,
    zIndex: id,
    locked: false,
    tags: [],
  }
}

export function createCanvasTemplateState(template: CanvasTemplateKey): InfiniteCanvasState {
  const state = createEmptyCanvasState()
  if (template === 'blank') return state

  if (template === 'project') {
    state.cards = [
      templateNote(1, 'Project brief', 'Outcome:\n\nConstraints:\n\nSuccess criteria:', '#6366f1', {
        x: 0,
        y: 0,
        width: 544,
        height: 352,
      }),
      templateNote(2, 'Architecture notes', 'Components:\n\nInterfaces:\n\nRisks:', '#0ea5e9', {
        x: 576,
        y: 0,
        width: 704,
        height: 352,
      }),
      templateNote(3, 'Decision log', '- Decision:\n  Why:\n  Consequences:', '#14b8a6', {
        x: 0,
        y: 384,
        width: 624,
        height: 320,
      }),
      templateNote(4, 'Next actions', '- [ ] ', '#14b8a6', {
        x: 656,
        y: 384,
        width: 624,
        height: 320,
      }),
    ]
  } else if (template === 'reading') {
    state.cards = [
      templateNote(1, 'Sources', '- ', '#0ea5e9', {
        x: 0,
        y: 0,
        width: 544,
        height: 544,
      }),
      templateNote(2, 'Reading notes', 'Questions:\n\nClaims:\n\nEvidence:\n\nQuotes:', '#8b5cf6', {
        x: 576,
        y: 0,
        width: 624,
        height: 352,
      }),
      templateNote(3, 'Synthesis', 'What changed my mind?\n\nWhat remains uncertain?', '#8b5cf6', {
        x: 576,
        y: 384,
        width: 624,
        height: 288,
      }),
    ]
  } else if (template === 'hardware') {
    state.cards = [
      templateNote(
        1,
        'Requirements',
        'Functional:\n\nElectrical:\n\nMechanical:\n\nConstraints:',
        '#6366f1',
        {
          x: 0,
          y: 0,
          width: 544,
          height: 384,
        },
      ),
      templateNote(2, 'Interfaces', 'Power:\nSignals:\nProtocols:\nConnectors:', '#f59e0b', {
        x: 576,
        y: 0,
        width: 544,
        height: 384,
      }),
      templateNote(3, 'Firmware & software', 'Modules:\n\nDependencies:\n\nDebugging:', '#14b8a6', {
        x: 1152,
        y: 0,
        width: 544,
        height: 384,
      }),
      templateNote(
        4,
        'Bring-up checklist',
        '- [ ] Power rails\n- [ ] Clock\n- [ ] Debug interface\n- [ ] Peripheral smoke tests',
        '#ec4899',
        {
          x: 0,
          y: 416,
          width: 832,
          height: 352,
        },
      ),
      templateNote(5, 'Validation evidence', 'Test:\nResult:\nEvidence:\nOpen issue:', '#ec4899', {
        x: 864,
        y: 416,
        width: 832,
        height: 352,
      }),
    ]
  } else {
    state.cards = [
      templateNote(1, 'Context', 'Background:\n\nSource material:\n\nDefinitions:', '#6366f1', {
        x: 0,
        y: 0,
        width: 544,
        height: 544,
      }),
      templateNote(
        2,
        'Prompt brief',
        'Role:\n\nGoal:\n\nConstraints:\n\nOutput format:\n\nEvaluation criteria:',
        '#8b5cf6',
        {
          x: 576,
          y: 0,
          width: 624,
          height: 544,
        },
      ),
      templateNote(3, 'Output review', 'Best result:\n\nProblems:\n\nNext iteration:', '#14b8a6', {
        x: 1232,
        y: 0,
        width: 544,
        height: 544,
      }),
    ]
  }
  state.nextItemId = state.cards.length + 1
  state.nextZIndex = state.cards.length + 1
  return state
}

export function canvasItemBounds(state: InfiniteCanvasState, id: string): CanvasRect | null {
  const window = state.windows.find((item) => item.id === id)
  if (window) return window.bounds
  const card = state.cards.find((item) => item.id === id)
  return card?.bounds ?? null
}

export type CanvasContextContent = { content: string; truncated?: boolean }

export function canvasItemTitle(state: InfiniteCanvasState, id: string): string {
  const card = state.cards.find((item) => item.id === id)
  if (card) return card.title || 'Untitled note'
  return state.windows.find((item) => item.id === id)?.definition.title || id
}

export function createReadingQuoteBody(quote: string, sourcePath: string): string {
  const quoted = quote
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quoted}\n\nSource: ${sourcePath}`
}

export function buildCanvasContext(
  state: InfiniteCanvasState,
  ids: string[],
  itemContents: Readonly<Record<string, CanvasContextContent>> = {},
): string {
  const selected = new Set(ids)
  const parts: string[] = ['# Canvas context']
  for (const id of ids) {
    const card = state.cards.find((item) => item.id === id)
    if (card) {
      const note = itemContents[card.id]
      parts.push(`\n## ${card.title || 'Note'}\n${note?.content ?? card.body}`)
      if (note?.truncated) parts.push('\n[Content truncated to fit AI context]')
      if (card.url) parts.push(`\nURL: ${card.url}`)
      if (card.tags.length) parts.push(`\nTags: ${card.tags.join(', ')}`)
      continue
    }
    const window = state.windows.find((item) => item.id === id)
    if (window) {
      const path =
        window.definition.initialState.viewing ?? window.definition.initialState.dir ?? ''
      parts.push(`\n## Source: ${window.definition.title}\n${path}`)
      const document = itemContents[window.id]
      if (document?.content) {
        parts.push(`\n${document.content}`)
        if (document.truncated) parts.push('\n[Content truncated to fit AI context]')
      }
    }
  }
  const links = state.connectors.filter(
    (item) => selected.has(item.fromId) && selected.has(item.toId),
  )
  if (links.length) {
    parts.push('\n## Relationships')
    for (const link of links) {
      const from = canvasItemTitle(state, link.fromId)
      const to = canvasItemTitle(state, link.toId)
      parts.push(`- ${from} -> ${to}${link.label ? `: ${link.label}` : ''}`)
    }
  }
  return parts.join('\n').trim()
}

export function createCanvasExport(name: string, state: InfiniteCanvasState): CanvasExportBundle {
  return { kind: 'derp-canvas', version: 1, name, exportedAt: Date.now(), state }
}

export function parseCanvasExport(value: unknown): CanvasExportBundle | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CanvasExportBundle>
  const state = parseInfiniteCanvasState(raw.state)
  if (raw.kind !== 'derp-canvas' || raw.version !== 1 || typeof raw.name !== 'string' || !state)
    return null
  return {
    kind: 'derp-canvas',
    version: 1,
    name: raw.name.slice(0, 120),
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
    state,
  }
}

export function parseCanvasSnapshots(value: string | null): CanvasSnapshot[] {
  if (!value) return []
  try {
    const raw = JSON.parse(value) as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const snapshot = value as Partial<CanvasSnapshot>
      const state = parseInfiniteCanvasState(snapshot.state)
      if (
        typeof snapshot.id !== 'string' ||
        typeof snapshot.canvasId !== 'string' ||
        typeof snapshot.name !== 'string' ||
        typeof snapshot.createdAt !== 'number' ||
        !state
      )
        return []
      return [{ ...snapshot, state } as CanvasSnapshot]
    })
  } catch {
    return []
  }
}
