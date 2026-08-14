import { describe, expect, test } from 'bun:test'

describe('viewer ownership boundaries', () => {
  test('Canvas hosts neutral feature content without workspace viewer state', async () => {
    const canvasSource = await Bun.file('src/CanvasPage.tsx').text()
    expect(canvasSource).toMatch(/integrations\/filesystem\/FilesystemResourceViewerContent/)
    expect(canvasSource).not.toMatch(/WorkspaceViewerPane|PersistedWorkspaceState|use-workspace/)
    expect(canvasSource).toMatch(/inspectCanvasCrashDraft/)
    expect(canvasSource).not.toMatch(
      /CANVAS_COLLECTION_STORAGE_KEY|CANVAS_STORAGE_KEY|infinite-canvas-state-v1/,
    )

    const workspaceCanvasSource = await Bun.file(
      'src/workspace/workspace-page/WorkspacePageCanvas.tsx',
    ).text()
    expect(workspaceCanvasSource).toMatch(
      /integrations\/filesystem\/FilesystemResourceViewerContent/,
    )
    expect(workspaceCanvasSource).not.toMatch(/WorkspaceViewerPane/)

    const canvasModel = await Bun.file('lib/infinite-canvas.ts').text()
    expect(canvasModel).not.toMatch(/WorkspaceWindowDefinition|use-workspace/)
  })

  test('viewer content owns no workspace state or retired file-item adapter', async () => {
    const featureSource = await Bun.file('src/features/viewer/ResourceViewerContent.tsx').text()
    expect(featureSource).not.toMatch(/use-workspace|PersistedWorkspaceState|WorkspaceViewerPane/)
    expect(featureSource).not.toMatch(/FileItem|adaptFileItemResource|legacy-content/)
    expect(featureSource).toMatch(/ContentRuntimeView/)
    expect(featureSource).toMatch(/runtime: ContentRuntime/)
    expect(featureSource).not.toMatch(/applicationContentRuntime|integrations\/registry/)
    expect(featureSource).not.toMatch(
      /<ImageViewerContent|<TextViewerContent|<ReaderContent|<UnsupportedViewerContent/,
    )

    const providerImports: string[] = []
    for await (const relative of new Bun.Glob('**/*.{ts,tsx}').scan('src/features/viewer')) {
      const source = await Bun.file(`src/features/viewer/${relative}`).text()
      if (/\/integrations\/(?:filesystem|hermes)\//.test(source)) providerImports.push(relative)
    }
    expect(providerImports).toEqual([])

    const filesystemRenderer = await Bun.file('src/integrations/filesystem/renderers.tsx').text()
    expect(filesystemRenderer).toMatch(/\.\/viewers\/ImageViewerContent/)
    expect(filesystemRenderer).toMatch(/\.\/viewers\/TextViewerContent/)
    expect(filesystemRenderer).toMatch(/\.\/viewers\/ReaderContent/)
    expect(await Bun.file('src/features/viewer/ImageViewerContent.tsx').exists()).toBe(false)
    expect(await Bun.file('src/features/viewer/TextViewerContent.tsx').exists()).toBe(false)
    expect(await Bun.file('src/features/reader/ReaderContent.tsx').exists()).toBe(false)
    expect(await Bun.file('src/integrations/filesystem/viewers/ReaderContent.tsx').exists()).toBe(
      true,
    )
  })

  test('core renderer registry owns matching only, not filesystem descriptors or loaders', async () => {
    const core = await Bun.file('src/features/open/renderer-registry.ts').text()
    const filesystem = await Bun.file('src/integrations/filesystem/renderers.tsx').text()

    expect(core).not.toMatch(
      /FILESYSTEM_RENDERER_ID|BUILT_IN_RENDERER_ID|builtInRendererDescriptors|AudioPlayer|VideoPlayer|ReaderContent|UnsupportedViewerContent|requires an integration mount adapter/,
    )
    expect(filesystem).toMatch(/export const filesystemRendererDescriptors/)
    expect(filesystem).toMatch(/load: loadFilesystemImageRenderer/)
    expect(filesystem).toMatch(/load: loadFilesystemTextRenderer/)
    expect(filesystem).toMatch(/load: loadFilesystemReaderRenderer/)
    expect(filesystem).toMatch(/load: loadFilesystemUnsupportedRenderer/)
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
