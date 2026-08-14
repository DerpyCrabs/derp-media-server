import { describe, expect, test } from 'bun:test'

describe('viewer ownership boundaries', () => {
  test('Canvas hosts neutral feature content without workspace viewer state', async () => {
    const canvasSource = await Bun.file('src/CanvasPage.tsx').text()
    expect(canvasSource).toMatch(/features\/viewer\/ResourceViewerContent/)
    expect(canvasSource).not.toMatch(/WorkspaceViewerPane|PersistedWorkspaceState|use-workspace/)
    expect(canvasSource).toMatch(/CANVAS_COLLECTION_STORAGE_KEY/)
    expect(canvasSource).not.toMatch(/CANVAS_STORAGE_KEY|infinite-canvas-state-v1/)

    const workspaceCanvasSource = await Bun.file(
      'src/workspace/workspace-page/WorkspacePageCanvas.tsx',
    ).text()
    expect(workspaceCanvasSource).toMatch(/features\/viewer\/ResourceViewerContent/)
    expect(workspaceCanvasSource).not.toMatch(/WorkspaceViewerPane/)

    const canvasModel = await Bun.file('lib/infinite-canvas.ts').text()
    expect(canvasModel).not.toMatch(/WorkspaceWindowDefinition|use-workspace/)
  })

  test('generic viewer content owns no workspace state dependency', async () => {
    const featureSource = await Bun.file('src/features/viewer/ResourceViewerContent.tsx').text()
    expect(featureSource).not.toMatch(/use-workspace|PersistedWorkspaceState|WorkspaceViewerPane/)
    expect(featureSource).not.toMatch(/integrations\/filesystem|adaptFileItemResource/)
    expect(featureSource).toMatch(/ContentRuntimeView/)
    expect(featureSource).toMatch(/runtime: ContentRuntime/)
    expect(featureSource).not.toMatch(/applicationContentRuntime|integrations\/registry/)
    expect(featureSource).not.toMatch(
      /<ImageViewerContent|<TextViewerContent|<ReaderContent|<UnsupportedViewerContent/,
    )
  })

  test('Workspace and Canvas show recoverable content failures instead of blank panes', async () => {
    const recovery = await Bun.file('src/features/content/ContentRecoveryView.tsx').text()
    const hosts = await Promise.all(
      ['src/CanvasPage.tsx', 'src/workspace/workspace-page/WorkspacePageCanvas.tsx'].map((path) =>
        Bun.file(path).text(),
      ),
    )

    expect(recovery).toMatch(/role='alert'/)
    for (const source of hosts) {
      expect(source).toMatch(/ContentRecoveryView/)
      expect(source).toMatch(/contentRecoveryReason/)
    }
  })

  test('Library non-media routes mount the application content runtime', async () => {
    const app = await Bun.file('src/App.tsx').text()
    const players = await Bun.file('src/media/MainMediaPlayers.tsx').text()
    expect(app).toMatch(/ContentRuntimeView/)
    expect(players).toMatch(/ContentRuntimeView/)
    expect(players).not.toMatch(
      /ImageViewerDialog|TextViewerDialog|UnsupportedFileViewerDialog|ReaderDialog/,
    )
  })

  test('Hermes renderer stays integration-owned instead of leaking into layout hosts', async () => {
    const renderer = await Bun.file('src/integrations/hermes/renderer.tsx').text()
    expect(renderer).toMatch(/\.\/HermesChatPane/)

    const hosts = await Promise.all(
      ['src/CanvasPage.tsx', 'src/workspace/workspace-page/WorkspacePageCanvas.tsx'].map((path) =>
        Bun.file(path).text(),
      ),
    )
    for (const source of hosts) expect(source).not.toMatch(/HermesChatPane/)
  })

  test('layout hosts mount and close integration content through the neutral runtime', async () => {
    const canvas = await Bun.file('src/CanvasPage.tsx').text()
    const workspace = await Bun.file('src/WorkspacePage.tsx').text()
    const workspaceCanvas = await Bun.file(
      'src/workspace/workspace-page/WorkspacePageCanvas.tsx',
    ).text()

    for (const source of [canvas, workspaceCanvas]) {
      expect(source).toMatch(/ContentRuntimeView/)
      expect(source).toMatch(/contentInstanceFromCurrentWindow/)
      expect(source).not.toMatch(/HermesChatPane/)
    }
    for (const source of [canvas, workspace]) {
      expect(source).toMatch(/applicationContentRuntime\.(canClose|release)/)
      expect(source).not.toMatch(/canCloseHermesWindow|discardHermesDraft/)
      expect(source).not.toMatch(/Hermes Sessions|type === ['"]hermes['"]|virtual-directory/)
    }
    expect(workspaceCanvas).not.toMatch(/bindHermesSession|openHermesBranch|renameHermesWindow/)
  })

  test('all three route shells place content through their neutral host adapter', async () => {
    const library = await Bun.file('src/FileBrowser.tsx').text()
    const workspace = await Bun.file('src/WorkspacePage.tsx').text()
    const canvas = await Bun.file('src/CanvasPage.tsx').text()

    expect(library).toMatch(/createLibraryHost/)
    expect(workspace).toMatch(/createWorkspaceHost/)
    expect(canvas).toMatch(/createCanvasHost/)
    expect(library).toMatch(/libraryHost\.open/)
    expect(workspace).toMatch(/workspaceContentHost\.open/)
    expect(canvas).toMatch(/canvasContentHost\.open/)
  })
})
