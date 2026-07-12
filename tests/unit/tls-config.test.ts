import { expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('TLS certificate paths are resolved relative to the selected config', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-tls-config-'))
  const configPath = path.join(directory, 'config.jsonc')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: 3000,
      mediaDir: directory,
      editableFolders: [],
      tls: { certPath: 'certs/server.crt', keyPath: 'certs/server.key' },
    }),
  )
  try {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        '-e',
        `import { config } from './lib/config.ts'; console.log(JSON.stringify(config.tls))`,
      ],
      cwd: path.resolve('.'),
      env: { ...process.env, CONFIG_PATH: configPath },
    })
    expect(result.exitCode).toBe(0)
    const tls = JSON.parse(result.stdout.toString()) as { certPath: string; keyPath: string }
    expect(tls.certPath).toBe(path.join(directory, 'certs/server.crt'))
    expect(tls.keyPath).toBe(path.join(directory, 'certs/server.key'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Android connection error page exposes retry and protocol detection', () => {
  const source = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/derpmedia/app/MainActivity.kt'),
    'utf8',
  )
  expect(source).toContain('href="derp://retry"')
  expect(source).toContain('ServerConnectionResolver.resolve(value)')
})
