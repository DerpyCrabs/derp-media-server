import { defineConfig } from 'vite'
import { scopePdfViewerCss } from './tooling/pdf-viewer-css'
import { effectweb } from '@effectweb/compiler/vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  cacheDir: process.env.BATCH_ID
    ? `node_modules/.vite-test-${process.env.BATCH_ID}-${process.env.PORT ?? 'build'}`
    : process.env.E2E_DEV === '1' || process.env.NODE_ENV === 'test'
      ? `node_modules/.vite-test-local-${process.env.PORT ?? 'build'}`
      : undefined,
  plugins: [scopePdfViewerCss(), effectweb(), tailwindcss()],
  server: {
    allowedHosts: true,
    hmr: process.env.VITE_HMR_PORT
      ? {
          host: process.env.E2E_DEV === '1' ? '127.0.0.1' : undefined,
          port: Number(process.env.VITE_HMR_PORT),
          clientPort: Number(process.env.VITE_HMR_CLIENT_PORT ?? process.env.VITE_HMR_PORT),
        }
      : undefined,
    watch: {
      ignored: [
        '**/test-media/**',
        '**/test-media-*/**',
        '**/test-data-*/**',
        '**/tests/fixtures/test-config-*',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/tests/**',
        '**/settings.json',
        '**/stats.json',
        '**/dist/**',
      ],
    },
  },
  resolve: { alias: { '@': path.resolve(configDir, 'src') } },
  build: { outDir: 'dist/client', emptyOutDir: true, manifest: true },
})
