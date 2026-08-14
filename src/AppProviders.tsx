import {
  QueryClient,
  QueryClientProvider,
  hydrate,
  type DehydratedState,
} from '@tanstack/solid-query'
import type { ParentProps } from 'solid-js'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'
import { SolidThemeSync } from './SolidThemeSync'

export function createAppQueryClient(dehydratedState?: DehydratedState): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        refetchOnWindowFocus: true,
      },
    },
  })

  if (dehydratedState) hydrate(queryClient, dehydratedState)
  return queryClient
}

export function AppProviders(props: ParentProps<{ queryClient: QueryClient }>) {
  return (
    <QueryClientProvider client={props.queryClient}>
      <SolidThemeSync />
      <GlobalForbiddenToast />
      {props.children}
    </QueryClientProvider>
  )
}
