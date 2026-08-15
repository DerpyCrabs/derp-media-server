import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const solid1DependencyCompat = {
  name: 'solid-1-dependency-compat',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const normalizedId = id.replaceAll('\\', '/')
    if (!normalizedId.includes('/node_modules/lucide-solid/dist/source/')) return undefined
    const match = code.match(/import \{([^}]*)\} from "solid-js";/)
    if (!match?.[1].includes('splitProps')) return undefined
    const imports = match[1]
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name && name !== 'splitProps')
    const runtimeImport = imports.length ? `import { ${imports.join(', ')} } from "solid-js";` : ''
    return {
      code: code.replace(
        match[0],
        `${runtimeImport}\nimport { splitProps } from "@/lib/solid-1-compat";`,
      ),
      map: null,
    }
  },
}

export default defineConfig({
  cacheDir:
    process.env.NODE_ENV === 'test'
      ? `node_modules/.vite-test${process.env.BATCH_ID ? `-${process.env.BATCH_ID}` : ''}`
      : undefined,
  plugins: [solid1DependencyCompat, solid(), tailwindcss()],
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
        '**/canvases.json',
        '**/settings.json',
        '**/stats.json',
        '**/dist/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(configDir, 'src'),
      // Keep Solid 1-only third-party packages on the Solid 2 runtime exports.
      'solid-js/web': '@solidjs/web',
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
