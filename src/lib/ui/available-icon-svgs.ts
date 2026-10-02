import { getIconGeometry } from './available-icons'

export function getAvailableIconSvg(iconName: string): string | null {
  const icon = getIconGeometry(iconName)
  if (!icon) return null
  const { iconNode, viewBox } = icon
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({
    xmlns: 'http://www.w3.org/2000/svg',
    width: '24',
    height: '24',
    viewBox,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }))
    svg.setAttribute(key, value)
  const append = (parent: Element, nodes: typeof iconNode) => {
    for (const [tag, attributes, children] of nodes) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const [key, value] of Object.entries(attributes))
        element.setAttribute(key, String(value))
      if (children) append(element, children)
      parent.appendChild(element)
    }
  }
  append(svg, iconNode)
  return svg.outerHTML
}
