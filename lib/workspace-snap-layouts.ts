import type { SnapZone } from '@/lib/use-workspace'

export interface SnapLayoutTemplate {
  id: string
  zones: (SnapZone | 'full')[]
  grid: { col: string; row: string; zone: SnapZone | 'full' }[]
  /** Number of grid rows (default 4). Use 3 for vertical-thirds so three equal rows fill the preview. */
  gridRows?: number
}

export const SNAP_LAYOUT_ROW_1: SnapLayoutTemplate[] = [
  {
    id: 'full',
    zones: ['full'],
    grid: [{ col: '1 / -1', row: '1 / -1', zone: 'full' }],
  },
  {
    id: 'left-right',
    zones: ['left', 'right'],
    grid: [
      { col: '1 / 4', row: '1 / -1', zone: 'left' },
      { col: '4 / 7', row: '1 / -1', zone: 'right' },
    ],
  },
  {
    id: 'left-right-stack',
    zones: ['left', 'top-right', 'bottom-right'],
    grid: [
      { col: '1 / 4', row: '1 / -1', zone: 'left' },
      { col: '4 / 7', row: '1 / 3', zone: 'top-right' },
      { col: '4 / 7', row: '3 / 5', zone: 'bottom-right' },
    ],
  },
  {
    id: 'stack-left-right',
    zones: ['top-left', 'bottom-left', 'right'],
    grid: [
      { col: '1 / 4', row: '1 / 3', zone: 'top-left' },
      { col: '1 / 4', row: '3 / 5', zone: 'bottom-left' },
      { col: '4 / 7', row: '1 / -1', zone: 'right' },
    ],
  },
]

export const SNAP_LAYOUT_ROW_2: SnapLayoutTemplate[] = [
  {
    id: 'quarters',
    zones: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    grid: [
      { col: '1 / 4', row: '1 / 3', zone: 'top-left' },
      { col: '4 / 7', row: '1 / 3', zone: 'top-right' },
      { col: '1 / 4', row: '3 / 5', zone: 'bottom-left' },
      { col: '4 / 7', row: '3 / 5', zone: 'bottom-right' },
    ],
  },
  {
    id: 'thirds-3x2',
    zones: [
      'top-left-third',
      'top-center-third',
      'top-right-third',
      'bottom-left-third',
      'bottom-center-third',
      'bottom-right-third',
    ],
    grid: [
      { col: '1 / 3', row: '1 / 3', zone: 'top-left-third' },
      { col: '3 / 5', row: '1 / 3', zone: 'top-center-third' },
      { col: '5 / 7', row: '1 / 3', zone: 'top-right-third' },
      { col: '1 / 3', row: '3 / 5', zone: 'bottom-left-third' },
      { col: '3 / 5', row: '3 / 5', zone: 'bottom-center-third' },
      { col: '5 / 7', row: '3 / 5', zone: 'bottom-right-third' },
    ],
  },
  {
    id: 'third-two-thirds',
    zones: ['left-third', 'right-two-thirds'],
    grid: [
      { col: '1 / 3', row: '1 / -1', zone: 'left-third' },
      { col: '3 / 7', row: '1 / -1', zone: 'right-two-thirds' },
    ],
  },
  {
    id: 'two-thirds-third',
    zones: ['left-two-thirds', 'right-third'],
    grid: [
      { col: '1 / 5', row: '1 / -1', zone: 'left-two-thirds' },
      { col: '5 / 7', row: '1 / -1', zone: 'right-third' },
    ],
  },
]

export const SNAP_LAYOUT_ROW_VERTICAL: SnapLayoutTemplate[] = [
  {
    id: 'full-vertical',
    zones: ['full'],
    grid: [{ col: '1 / -1', row: '1 / -1', zone: 'full' }],
  },
  {
    id: 'vertical-thirds',
    zones: ['top-third', 'middle-third', 'bottom-third'],
    gridRows: 3,
    grid: [
      { col: '1 / -1', row: '1 / 2', zone: 'top-third' },
      { col: '1 / -1', row: '2 / 3', zone: 'middle-third' },
      { col: '1 / -1', row: '3 / 4', zone: 'bottom-third' },
    ],
  },
  {
    id: 'half-top-two-quarters-bottom',
    zones: ['top-half', 'bottom-left', 'bottom-right'],
    grid: [
      { col: '1 / -1', row: '1 / 3', zone: 'top-half' },
      { col: '1 / 4', row: '3 / 5', zone: 'bottom-left' },
      { col: '4 / 7', row: '3 / 5', zone: 'bottom-right' },
    ],
  },
  {
    id: 'top-bottom-stack',
    zones: ['top-half', 'bottom-half'],
    grid: [
      { col: '1 / -1', row: '1 / 3', zone: 'top-half' },
      { col: '1 / -1', row: '3 / 5', zone: 'bottom-half' },
    ],
  },
]

export const ALL_SNAP_LAYOUT_IDS: string[] = [
  ...SNAP_LAYOUT_ROW_1.map((t) => t.id),
  ...SNAP_LAYOUT_ROW_2.map((t) => t.id),
  ...SNAP_LAYOUT_ROW_VERTICAL.map((t) => t.id),
]

export function filterSnapTemplates(
  templates: SnapLayoutTemplate[],
  visibleIds: Set<string>,
): SnapLayoutTemplate[] {
  return templates.filter((t) => visibleIds.has(t.id))
}
