/* @refresh reload */
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './globals.css'
import type { DehydratedState } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { App } from './App'
import { AppProviders, createAppQueryClient } from './AppProviders'
import { replaceEnabledIntegrations } from './integrations/availability'
import { integrationDescriptorsQueryOptions } from './integrations/query-options'

declare global {
  interface Window {
    __DEHYDRATED_STATE__?: DehydratedState
  }
}

const queryClient = createAppQueryClient(window.__DEHYDRATED_STATE__)

const root = document.getElementById('root')
async function bootstrap() {
  const descriptors = await queryClient
    .ensureQueryData(integrationDescriptorsQueryOptions())
    .catch(() => null)
  if (descriptors) replaceEnabledIntegrations(descriptors)
  if (!root) return
  render(
    () => (
      <AppProviders queryClient={queryClient}>
        <App />
      </AppProviders>
    ),
    root,
  )
}

void bootstrap()
