import { omit } from 'solid-js'

export function splitProps<T extends Record<PropertyKey, unknown>, K extends readonly (keyof T)[]>(
  props: T,
  keys: K,
): [Pick<T, K[number]>, Omit<T, K[number]>] {
  const picked = {} as Pick<T, K[number]>
  for (const key of keys) {
    Object.defineProperty(picked, key, {
      configurable: true,
      enumerable: true,
      get: () => props[key],
    })
  }
  const rest = omit(props, ...keys) as unknown as Omit<T, K[number]>
  return [picked, rest]
}
