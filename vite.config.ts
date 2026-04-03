import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    watch: {
      ignored: ['**/kb-chats.json', '**/shares.json', '**/settings.json', '**/stats.json'],
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
  },
})
