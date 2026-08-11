import type { ExplorerModel, ExplorerSnapshot } from '@/lib/explorer-model'
import { createSignal, onCleanup, onMount } from 'solid-js'

export function useExplorerModel(model: ExplorerModel) {
  const [snapshot, setSnapshot] = createSignal<ExplorerSnapshot>(model.getSnapshot())

  onMount(() => {
    const unsubscribe = model.subscribe(() => setSnapshot(model.getSnapshot()))
    void model.dispatch({ type: 'initialize' })
    onCleanup(() => {
      unsubscribe()
      model.dispose()
    })
  })

  return {
    snapshot,
    dispatch: model.dispatch.bind(model),
    model,
  }
}
