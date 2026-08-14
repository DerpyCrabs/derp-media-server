import { queryOptions } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import { loadIntegrationDescriptors } from './http-client'

export function integrationDescriptorsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.integrations(),
    queryFn: ({ signal }) => loadIntegrationDescriptors(signal),
    staleTime: Infinity,
  })
}
