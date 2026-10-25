import {
  parseDelimited,
  queryDelimited,
  type DelimitedData,
  type Delimiter,
  type DelimiterChoice,
  type TableSort,
} from './delimited-text'
export type TableWorkerRequest = {
  id: number
  source?: string
  choice: DelimiterChoice
  preferred: Delimiter
  filter: string
  header: boolean
  sort: TableSort
}
export type TableWorkerResponse = {
  id: number
  data?: DelimitedData
  order: number[]
  error?: string
}
let data: DelimitedData | undefined
self.onmessage = (event: MessageEvent<TableWorkerRequest>) => {
  const request = event.data
  try {
    if (request.source !== undefined)
      data = parseDelimited(request.source, request.choice, request.preferred)
    self.postMessage({
      id: request.id,
      ...(request.source !== undefined ? { data } : {}),
      order: data ? queryDelimited(data, request.filter, request.header, request.sort) : [],
    } satisfies TableWorkerResponse)
  } catch {
    self.postMessage({
      id: request.id,
      order: [],
      error: 'Could not prepare this table. Open the text view to inspect the source.',
    } satisfies TableWorkerResponse)
  }
}
