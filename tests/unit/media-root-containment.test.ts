import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { assertCanonicalContainment } from '@/lib/file-system'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('media root canonical containment', () => {
  test('rejects paths escaping through a directory symlink or junction', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-containment-'))
    tempDirs.push(temp)
    const root = path.join(temp, 'root')
    const outside = path.join(temp, 'outside')
    const link = path.join(root, 'escape')
    fs.mkdirSync(root)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

    expect(() => assertCanonicalContainment(path.join(link, 'secret.txt'), root)).toThrow(
      /Symbolic link escapes media root/,
    )
  })

  test('allows existing and not-yet-created paths inside the root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-containment-root-'))
    tempDirs.push(root)
    const folder = path.join(root, 'folder')
    fs.mkdirSync(folder)

    expect(() => assertCanonicalContainment(folder, root)).not.toThrow()
    expect(() => assertCanonicalContainment(path.join(folder, 'new.txt'), root)).not.toThrow()
  })
})
