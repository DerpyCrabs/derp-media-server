import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

const port = 6091

export default defineConfig({
  ...baseConfig,
  testMatch: 'solid-reactivity.spec.ts',
  use: {
    ...baseConfig.use,
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    command: 'bun run dev',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(port),
      CONFIG_PATH: 'tests/fixtures/test-config.jsonc',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1',
    },
  },
})
