// Why: the single content hasher for Pierre diff identity. Kept in its own
// module (no React / @pierre imports) so the diff-arrival path can attach a
// fingerprint without pulling the lazy DiffViewer chunk into the eager bundle.
// The separate FNV-1a in diff-content-signature.ts serves Monaco model-rotation
// keys and is intentionally not merged here — these are two distinct keyings.
const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193
const SECONDARY_HASH_SEED = 0x9e3779b9
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b

function fnv1a32(input: string, seed: number, multiplier: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, multiplier) >>> 0
  }
  return hash >>> 0
}

// Why: double-FNV plus length keeps collisions vanishingly unlikely for the
// content-addressed cacheKey embedded in Pierre FileContents; a collision would
// silently reuse a stale highlighted/parsed result.
export function getContentFingerprint(content: string): string {
  const primary = fnv1a32(content, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36)
  const secondary = fnv1a32(content, SECONDARY_HASH_SEED, SECONDARY_HASH_MULTIPLIER).toString(36)
  return `${content.length}:${primary}:${secondary}`
}

// Why: the CodeView item version must change whenever the diff identity changes
// so Pierre swaps content in place (P5) instead of remounting. A 32-bit hash of
// the identity string is a compact, stable version number.
export function getDiffIdentityVersion(identity: string): number {
  return fnv1a32(identity, FNV_OFFSET_BASIS_32, FNV_PRIME_32)
}
