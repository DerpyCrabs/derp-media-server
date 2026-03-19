import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ALL_SNAP_LAYOUT_IDS } from '@/lib/workspace-snap-layouts'
import { useWorkspaceSnapLayoutVisibilityStore } from '@/lib/workspace-snap-layout-visibility-store'

const KNOWN = new Set(ALL_SNAP_LAYOUT_IDS)

function cleanSet(ids: Set<string>): Set<string> {
  const next = new Set<string>()
  for (const id of ids) {
    if (KNOWN.has(id)) next.add(id)
  }
  return next
}

export function useWorkspaceSnapLayoutVisibility() {
  const {
    visibleIdList,
    setVisibleIds: storeSetVisibleIds,
    toggleLayout,
    showAllLayouts,
  } = useWorkspaceSnapLayoutVisibilityStore(
    useShallow((s) => ({
      visibleIdList: s.visibleIdList,
      setVisibleIds: s.setVisibleIds,
      toggleLayout: s.toggleLayout,
      showAllLayouts: s.showAllLayouts,
    })),
  )

  const visibleIds = useMemo(() => new Set(visibleIdList), [visibleIdList])

  const setVisibleIds = (next: Set<string>) => {
    storeSetVisibleIds(cleanSet(next))
  }

  return { visibleIds, setVisibleIds, toggleLayout, showAllLayouts }
}
