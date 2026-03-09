import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  type DehydratedState,
} from '@tanstack/react-query'
import { App } from './App'

declare global {
  interface Window {
    __DEHYDRATED_STATE__?: DehydratedState
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: true,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={window.__DEHYDRATED_STATE__}>
        <App />
      </HydrationBoundary>
    </QueryClientProvider>
  </StrictMode>,
)
