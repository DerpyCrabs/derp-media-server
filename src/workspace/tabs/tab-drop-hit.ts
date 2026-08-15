/** Left fraction of a tab = insert *before* that tab; right = insert *after*. */
export const TAB_DROP_BEFORE_FRACTION = 0.4

export function insertIndexFromTabBodyPointer(
  clientX: number,
  tabLeft: number,
  tabWidth: number,
  tabIndex: number,
): number {
  if (tabWidth <= 0) return tabIndex + 1
  const rel = clientX - tabLeft
  const before = rel < TAB_DROP_BEFORE_FRACTION * tabWidth
  return before ? tabIndex : tabIndex + 1
}
