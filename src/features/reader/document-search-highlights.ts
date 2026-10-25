import { findDocumentMatches, type DocumentMatch } from './document-search'
let nextHighlight = 0
export function createDocumentSearchHighlights(
  host: HTMLElement,
  current: () => {
    searchQuery?: string
    activeMatch?: DocumentMatch
    pageIndex: number
    ready?: boolean
  },
  selector: string | null = '.textLayer',
) {
  const name = `document-search-${++nextHighlight}`
  const activeName = `${name}-active`
  const style = document.createElement('style')
  style.textContent = `::highlight(${name}) { background-color: #ffda6680; color: black; } ::highlight(${activeName}) { background-color: #ff9f43; color: black; }`
  document.head.append(style)
  let previousActive = ''
  let previousLayer: Element | null | undefined
  let previousQuery = ''
  const clear = () => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete(name)
      CSS.highlights.delete(activeName)
    }
  }
  return {
    update() {
      if (typeof Highlight === 'undefined' || !CSS.highlights) return
      const props = current()
      const layer = selector ? host.querySelector(selector) : host
      const signature = `${props.searchQuery}:${props.activeMatch?.page}:${props.activeMatch?.from}:${props.ready}`
      if (layer === previousLayer && signature === previousQuery) return
      previousLayer = layer
      previousQuery = signature
      clear()
      if (!props.searchQuery || !layer) {
        previousActive = ''
        return
      }
      const nodes: { node: Text; start: number; end: number }[] = []
      let text = ''
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = text.length
        text += node.textContent ?? ''
        nodes.push({ node: node as Text, start, end: text.length })
      }
      const matches = findDocumentMatches(text, props.searchQuery, props.pageIndex)
      const ranges: Range[] = []
      let selected: Range | undefined
      for (const match of matches) {
        const first = nodes.find((node) => node.end > match.from)
        const last = nodes.find((node) => node.end >= match.to)
        if (!first || !last) continue
        const range = document.createRange()
        range.setStart(first.node, match.from - first.start)
        range.setEnd(last.node, match.to - last.start)
        ranges.push(range)
        if (props.activeMatch?.page === props.pageIndex && props.activeMatch.from === match.from)
          selected = range
      }
      CSS.highlights.set(name, new Highlight(...ranges))
      if (selected) {
        CSS.highlights.set(activeName, new Highlight(selected))
        const key = `${props.searchQuery}:${props.activeMatch?.from}`
        if (previousActive !== key && props.ready !== false) {
          previousActive = key
          selected.startContainer.parentElement?.scrollIntoView({
            block: 'center',
            inline: 'nearest',
          })
        }
      } else previousActive = ''
    },
    dispose() {
      clear()
      style.remove()
    },
  }
}
