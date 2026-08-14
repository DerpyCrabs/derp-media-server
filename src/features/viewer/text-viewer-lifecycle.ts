export type TextViewerCloseController = Readonly<{
  canClose(): Promise<boolean>
}>

export type TextViewerCloseControllerOptions = Readonly<{
  autoSaveEnabled(): boolean
  dirty(): boolean
  editable(): boolean
  conflict(): boolean
  cancelScheduledSave(): void
  awaitPendingSaves(): Promise<void>
  save(): Promise<void>
}>

const controllers = new Map<string, TextViewerCloseController>()

export function createTextViewerCloseController(
  options: TextViewerCloseControllerOptions,
): TextViewerCloseController {
  let closeRequest: Promise<boolean> | null = null

  const run = async () => {
    options.cancelScheduledSave()
    try {
      await options.awaitPendingSaves()
      if (
        options.editable() &&
        options.autoSaveEnabled() &&
        !options.conflict() &&
        options.dirty()
      ) {
        await options.save()
        await options.awaitPendingSaves()
      }
    } catch {
      return false
    }
    return !options.autoSaveEnabled() || !options.dirty()
  }

  return Object.freeze({
    canClose() {
      if (closeRequest) return closeRequest
      closeRequest = run().finally(() => {
        closeRequest = null
      })
      return closeRequest
    },
  })
}

export function registerTextViewerCloseController(
  instanceId: string,
  controller: TextViewerCloseController,
): () => void {
  controllers.set(instanceId, controller)
  return () => {
    if (controllers.get(instanceId) === controller) controllers.delete(instanceId)
  }
}

export async function canCloseTextViewerContent(instanceId: string): Promise<boolean> {
  return (await controllers.get(instanceId)?.canClose()) ?? true
}
