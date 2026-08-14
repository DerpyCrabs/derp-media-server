import type { ContentInstance } from '@/lib/domain/content'
import type { ContentRuntime } from './runtime'

export async function confirmContentClose(
  runtime: Pick<ContentRuntime, 'canClose'>,
  instances: readonly ContentInstance[],
  stillCurrent: () => boolean,
): Promise<boolean> {
  if (!stillCurrent()) return false
  for (const instance of instances) {
    if (!(await runtime.canClose(instance)) || !stillCurrent()) return false
  }
  return stillCurrent()
}
