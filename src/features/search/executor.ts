import type { ResourceOpener, OpenContext, OpenPlan } from '../open/open-resource'
import type { SearchCoordinator } from './coordinator'
import type { SearchHit } from './contracts'

export type SearchExecutionCallbacks = Readonly<{
  opener: ResourceOpener
  context: OpenContext
  place(hit: SearchHit, plan: OpenPlan): void | Promise<void>
}>

export async function executeSearchHit(
  coordinator: SearchCoordinator,
  hit: SearchHit,
  callbacks: SearchExecutionCallbacks,
): Promise<'placed' | 'executed' | 'blocked'> {
  if (hit.resource) {
    const plan = callbacks.opener(hit.resource, 'default', callbacks.context)
    if (plan.status === 'blocked') return 'blocked'
    await callbacks.place(hit, plan)
    return 'placed'
  }
  return (await coordinator.execute(hit)) ? 'executed' : 'blocked'
}
