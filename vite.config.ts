import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  cacheDir:
    process.env.NODE_ENV === 'test'
      ? `node_modules/.vite-test${process.env.BATCH_ID ? `-${process.env.BATCH_ID}` : ''}`
      : undefined,
  plugins: [solid(), tailwindcss()],
  server: {
    allowedHosts: true,
    hmr: process.env.VITE_HMR_PORT
      ? {
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
        '**/mounts.json',
        '**/canvases.json',
        '**/settings.json',
        '**/stats.json',
        '**/dist/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-solid'],
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    manifest: true,
  },
})
