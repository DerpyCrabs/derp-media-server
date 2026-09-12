type QueryDataState<T> = {
  data: T
  isPending: boolean
  isError: boolean
  dataUpdatedAt: number
}

/** Read optional query data without suspending on an unfetched or failed query. */
export function queryData<T>(query: QueryDataState<T> | undefined): T | undefined {
  if (!query || query.isPending || (query.isError && query.dataUpdatedAt === 0)) return undefined
  return query.data
}
