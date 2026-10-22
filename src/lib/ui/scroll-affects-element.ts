export function scrollAffectsElement(event: Event, element: Element): boolean {
  const target = event.target
  const view = element.ownerDocument.defaultView
  return view !== null && target instanceof view.Node && target.contains(element)
}
