import { describe, expect, test } from 'bun:test'
import {
  hasVirtualCapability,
  virtualEntrySubtitle,
  virtualFileSizeVisible,
  type VirtualEntry,
} from '@/lib/files/virtual-directory'
import { virtualAppearanceForPath } from '@/features/explorer/virtual-directory-appearance'

describe('virtual-directory interface', () => {
  test('drives behavior from capabilities instead of provider paths', () => {
    const entry: VirtualEntry = {
      provider: 'fake',
      kind: 'session',
      capabilities: ['open', 'archive'],
    }
    expect(hasVirtualCapability(entry, 'archive')).toBe(true)
    expect(hasVirtualCapability(entry, 'deletePermanently')).toBe(false)
  })

  test('uses one appearance resolver for Hermes rows, windows, and pins', () => {
    expect(virtualAppearanceForPath('Hermes Sessions')).toEqual({
      icon: 'agent-directory',
      tone: 'violet',
    })
    expect(virtualAppearanceForPath('Hermes Sessions/session/abc')).toEqual({
      icon: 'agent-session',
      tone: 'violet',
    })
    expect(virtualAppearanceForPath('Hermes Sessions/project/p1')).toEqual({
      icon: 'project',
      tone: 'indigo',
    })
    expect(virtualAppearanceForPath('Documents')).toBeUndefined()
  })

  test('hides meaningless sizes for virtual entries', () => {
    expect(virtualFileSizeVisible({ isDirectory: false })).toBe(true)
    expect(
      virtualFileSizeVisible(
        { isDirectory: false },
        {
          provider: 'hermes',
          kind: 'session',
          capabilities: [],
        },
      ),
    ).toBe(false)
  })

  test('summarizes Hermes session state without fake file metadata', () => {
    expect(
      virtualEntrySubtitle({
        provider: 'hermes',
        kind: 'session',
        capabilities: [],
        metadata: { pending_approval: true, source: 'desktop', cwd: 'C:/work/app' },
      }),
    ).toBe('Needs input · desktop · app')
  })
})
