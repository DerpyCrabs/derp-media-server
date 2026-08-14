import { describe, expect, test } from 'bun:test'

describe('frontend integration boundaries', () => {
  test('Hermes content lives in its integration and has neutral host inputs', async () => {
    const pane = Bun.file('src/integrations/hermes/HermesChatPane.tsx')
    const card = Bun.file('src/integrations/hermes/HermesMessageCard.tsx')

    expect(await pane.exists()).toBe(true)
    expect(await card.exists()).toBe(true)
    const paneSource = await pane.text()
    expect(paneSource).not.toMatch(/use-workspace|WorkspaceWindowDefinition|props\.window/)
    expect(paneSource).toMatch(/content: \(\) => HermesContentState/)

    expect(await Bun.file('src/workspace/HermesChatPane.tsx').exists()).toBe(false)
    expect(await Bun.file('src/workspace/HermesMessageCard.tsx').exists()).toBe(false)
  })

  test('core content and opener contain no Hermes or fake-path branch', async () => {
    const sources = await Promise.all(
      [
        'src/features/content/contracts.ts',
        'src/features/content/registry.ts',
        'src/features/content/runtime.ts',
        'src/features/open/open-resource.ts',
        'src/features/viewer/ResourceViewerContent.tsx',
      ].map((path) => Bun.file(path).text()),
    )
    expect(sources.join('\n')).not.toMatch(
      /\bhermes\b|Hermes Sessions|hermesSession|hermesDraft|integrations\/registry/,
    )
  })

  test('layout and chrome contain no provider branch or fabricated provider path', async () => {
    const sources = await Promise.all(
      [
        'src/WorkspacePage.tsx',
        'src/CanvasPage.tsx',
        'src/workspace/workspace-page/WorkspacePageCanvas.tsx',
        'src/workspace/WorkspaceTaskbarRows.tsx',
        'src/lib/use-file-icon.tsx',
        'lib/use-workspace.ts',
        'lib/infinite-canvas.ts',
        'lib/workspace-path-mutation.ts',
      ].map((path) => Bun.file(path).text()),
    )

    expect(sources.join('\n')).not.toMatch(
      /\bhermes\b|Hermes Sessions|hermes:\/\/|virtualOpenTarget|\/api\/virtual-directory/,
    )
  })
})
