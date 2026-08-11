import type { ExplorerError, ExplorerOutcome } from '@/lib/explorer-model'
import { createSignal } from 'solid-js'

type MutationCallbacks<TVariables> = Readonly<{
  onSuccess?: (outcome: ExplorerOutcome, variables: TVariables) => void
  onError?: (error: Error, variables: TVariables) => void
  onSettled?: (
    outcome: ExplorerOutcome | undefined,
    error: Error | null,
    variables: TVariables,
  ) => void
}>

type MutationOptions<TVariables> = MutationCallbacks<TVariables>

function outcomeError(outcome: ExplorerOutcome): ExplorerError | undefined {
  return outcome.kind === 'unavailable' ? outcome.error : undefined
}

export function createExplorerMutation<TVariables>(
  execute: (variables: TVariables) => Promise<ExplorerOutcome>,
  options: MutationOptions<TVariables> = {},
) {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<Error | null>(null)

  async function mutateAsync(
    variables: TVariables,
    callbacks: MutationCallbacks<TVariables> = {},
  ): Promise<ExplorerOutcome> {
    setPending(true)
    setError(null)
    let outcome: ExplorerOutcome | undefined
    let caught: Error | null = null
    try {
      outcome = await execute(variables)
      const unavailable = outcomeError(outcome)
      if (unavailable) throw new Error(unavailable.message)
      options.onSuccess?.(outcome, variables)
      callbacks.onSuccess?.(outcome, variables)
      return outcome
    } catch (value) {
      caught = value instanceof Error ? value : new Error('Explorer command failed')
      setError(caught)
      options.onError?.(caught, variables)
      callbacks.onError?.(caught, variables)
      throw caught
    } finally {
      setPending(false)
      options.onSettled?.(outcome, caught, variables)
      callbacks.onSettled?.(outcome, caught, variables)
    }
  }

  return {
    get isPending() {
      return pending()
    },
    get isError() {
      return error() !== null
    },
    get error() {
      return error()
    },
    mutate(variables: TVariables, callbacks?: MutationCallbacks<TVariables>) {
      void mutateAsync(variables, callbacks).catch(() => undefined)
    },
    mutateAsync,
    reset() {
      setError(null)
    },
  }
}
