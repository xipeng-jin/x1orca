export const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>()

export function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}

export function reuseSetIfEqual<T>(current: ReadonlySet<T>, next: Set<T>): Set<T> | ReadonlySet<T> {
  return setsEqual(current, next) ? current : next
}

export function reuseArrayIfEqual<T>(previous: T[] | undefined, next: T[]): T[] {
  if (!previous || previous.length !== next.length) {
    return next
  }
  for (let i = 0; i < next.length; i += 1) {
    if (previous[i] !== next[i]) {
      return next
    }
  }
  return previous
}
