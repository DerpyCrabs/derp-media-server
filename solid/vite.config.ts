import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: dir,
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dir, '..'),
    },
  },
  build: {
    outDir: path.resolve(dir, '../dist/client-solid'),
    emptyOutDir: true,
  },
})
