/* @refresh reload */
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './globals.css'
import {
  QueryClient,
  QueryClientProvider,
  hydrate,
  type DehydratedState,
} from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { App } from './App'
import { initializeWebOfflineCatalog } from './lib/web-offline-storage'

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

const dehydrated = window.__DEHYDRATED_STATE__
if (dehydrated) {
  hydrate(queryClient, dehydrated)
}

void initializeWebOfflineCatalog()

if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/service-worker.js', { updateViaCache: 'none' })
      .then(async () => {
        await navigator.serviceWorker.ready
        const reportReady = () =>
          window.DerpAndroid?.postMessage(
            JSON.stringify({ type: 'serviceWorkerReady', origin: location.origin }),
          )
        if (navigator.serviceWorker.controller) reportReady()
        else
          navigator.serviceWorker.addEventListener('controllerchange', reportReady, { once: true })
      })
  })
}

const root = document.getElementById('root')
if (root) {
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    ),
    root,
  )
}
