import { queryData } from '@/lib/api/query-data'
import { createMemo } from 'solid-js'
import { useSettingsQuery } from '@/lib/api/use-app-data'

export function useExplorerSettings() {
  const settingsQuery = useSettingsQuery()

  const knowledgeBases = createMemo(() => queryData(settingsQuery)?.knowledgeBases ?? [])
  const customIcons = createMemo(() => queryData(settingsQuery)?.customIcons ?? {})

  return { settingsQuery, knowledgeBases, customIcons }
}
