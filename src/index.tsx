/* @refresh reload */
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './globals.css'
import type { DehydratedState } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { App } from './App'
import { AppProviders, createAppQueryClient } from './AppProviders'

declare global {
  interface Window {
    __DEHYDRATED_STATE__?: DehydratedState
  }
}

const queryClient = createAppQueryClient(window.__DEHYDRATED_STATE__)

const root = document.getElementById('root')
if (root) {
  render(
    () => (
      <AppProviders queryClient={queryClient}>
        <App />
      </AppProviders>
    ),
    root,
  )
}
