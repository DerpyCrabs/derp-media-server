function jsonKeys(value: Record<string, unknown>) {
  return Object.keys(value).filter((key) => value[key] !== undefined)
}

/** Compares workspace values by JSON meaning without depending on object insertion order. */
export function workspaceValueEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => workspaceValueEquals(value, right[index]))
    )
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false
  }

  const leftObject = left as Record<string, unknown>
  const rightObject = right as Record<string, unknown>
  const leftKeys = jsonKeys(leftObject)
  const rightKeys = jsonKeys(rightObject)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightObject, key) &&
        rightObject[key] !== undefined &&
        workspaceValueEquals(leftObject[key], rightObject[key]),
    )
  )
}
