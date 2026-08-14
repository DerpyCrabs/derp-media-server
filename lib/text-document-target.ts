import { createKeyedAsyncTaskQueue } from './async-task-queue'
import { filesystemResourceAddress, type ResourceKey } from './domain/resource'

export type TextDocumentTarget = Readonly<{
  resource: ResourceKey
}>

const saveQueue = createKeyedAsyncTaskQueue<string>()

export function createTextDocumentTarget(resource: ResourceKey): TextDocumentTarget {
  if (!filesystemResourceAddress(resource)) {
    throw new Error('Text document target requires a filesystem ResourceKey')
  }
  return { resource }
}

export function textDocumentTargetKey(target: TextDocumentTarget): string {
  return JSON.stringify([target.resource.provider, target.resource.id])
}

export function textDocumentPath(target: TextDocumentTarget): string {
  const address = filesystemResourceAddress(target.resource)
  if (!address) throw new Error('Text document target requires a filesystem ResourceKey')
  return address.path
}

export function enqueueTextDocumentSave<T>(
  target: TextDocumentTarget,
  task: () => Promise<T>,
): Promise<T> {
  return saveQueue.run(textDocumentTargetKey(target), task)
}
