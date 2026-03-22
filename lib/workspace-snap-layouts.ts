/**
 * Tiling presets are fixed grid shapes (see assist bar + edge snap).
 * @deprecated Use AssistGridShape from workspace-assist-grid.
 */
export type { AssistGridShape } from '@/lib/workspace-assist-grid'
export {
  ASSIST_GRID_SHAPES,
  isAssistGridShape,
  migrateTemplateIdToAssistShape,
} from '@/lib/workspace-assist-grid'

import { ASSIST_GRID_SHAPES } from '@/lib/workspace-assist-grid'

/** Kept for migration / settings keys; values are grid shape ids only. */
export const ALL_SNAP_LAYOUT_IDS: string[] = [...ASSIST_GRID_SHAPES]
