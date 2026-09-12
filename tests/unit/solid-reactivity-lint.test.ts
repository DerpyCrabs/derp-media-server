import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const oxlint = resolve(import.meta.dir, '../../node_modules/oxlint/bin/oxlint')

function lint(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'solid-reactivity-'))
  try {
    const config = join(dir, 'config.json')
    const file = join(dir, 'example.js')
    writeFileSync(
      config,
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: [require.resolve('eslint-plugin-solid')],
        rules: { 'solid/reactivity': 'error' },
      }),
    )
    writeFileSync(
      file,
      `import { createMemo, createSignal } from 'solid-js';
       export function Widget(props) {
         const [count] = createSignal(0);
         const parsed = createMemo(() => props.value);
         ${body}
       }`,
    )
    const result = Bun.spawnSync([
      process.execPath,
      oxlint,
      '--config',
      config,
      '--format',
      'json',
      '--threads',
      '1',
      file,
    ])
    return { exitCode: result.exitCode, output: result.stdout.toString() }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a helper reads reactive data when called inside a memo', () => {
  const result = lint(`const get = () => {
    const value = parsed();
    return value.name;
  };
  const text = createMemo(() => get());
  return text;`)
  expect(result.exitCode).toBe(0)
  expect(result.output).not.toContain('solid(reactivity)')
})

test.each([
  'return () => value;',
  'return { read: () => value };',
  'const read = () => value; return read;',
  'function read() { return value; } return read;',
])('an escaped callback still reports a stale capture: %s', (returned) => {
  const result = lint(`const capture = () => {
      const value = count();
      ${returned}
    };
    return capture;`)
  expect(result.exitCode).toBe(1)
  expect(result.output).toContain("'value' captures the value of the reactive variable 'count'")
})
