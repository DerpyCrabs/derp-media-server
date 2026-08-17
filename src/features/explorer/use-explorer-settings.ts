import { createMemo } from 'solid-js'
import { useSettingsQuery } from '@/lib/api/use-app-data'

export function useExplorerSettings() {
  const settingsQuery = useSettingsQuery()

  const knowledgeBases = createMemo(() => settingsQuery.data?.knowledgeBases ?? [])
  const customIcons = createMemo(() => settingsQuery.data?.customIcons ?? {})

  return { settingsQuery, knowledgeBases, customIcons }
}
