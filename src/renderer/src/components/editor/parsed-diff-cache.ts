import { parseDiffFromFile, type FileContents, type FileDiffMetadata } from '@pierre/diffs'
import { setWithLRU } from '@/lib/scroll-cache'
import { getContentFingerprint } from './pierre-content-fingerprint'

// Why: 240 mirrors Pierre's per-pool highlight AST LRU (totalASTLRUCacheSize),
// so a diff whose parsed metadata is still cached here is also likely to still
// hold its highlighted AST upstream — the two caches age together. A long
// session opens many diffs, so this must be bounded, not an unbounded Map.
export const PARSED_DIFF_CACHE_MAX_ENTRIES = 240

// Why: a NUL joins the two sides' identities unambiguously since it cannot
// appear in a path or fingerprint. Built via fromCharCode (not a literal NUL
// byte) so the source stays plain text — an embedded NUL makes Git treat the
// whole file as binary and hides its diff.
const PARSED_DIFF_CACHE_KEY_SEPARATOR = String.fromCharCode(0)

// Why: module-level so the parse survives DiffViewer remounts (tab revisits, P5
// reload remounts, dev StrictMode double-mounts); the per-mount useMemo only
// dedupes within one mounted instance. A plain Map (no window access) is SSR /
// test safe.
const parsedDiffCache = new Map<string, FileDiffMetadata>()

function fileContentsIdentity(file: FileContents): string {
  // Why: cacheKey already encodes name + lang + content fingerprint; fall back
  // to the same name+fingerprint shape getPierreCodeViewDiffIdentity uses if a
  // caller ever omits it, so the key never collapses to a weaker identity.
  return file.cacheKey ?? `${file.name}:${getContentFingerprint(file.contents)}`
}

function parsedDiffCacheKey(oldFile: FileContents, newFile: FileContents): string {
  // Why: combining both sides captures everything parse output depends on — each
  // side's name AND content — so a modified-side change or an original-side-only
  // change (git add) rotates the key, misses, and re-parses.
  return `${fileContentsIdentity(oldFile)}${PARSED_DIFF_CACHE_KEY_SEPARATOR}${fileContentsIdentity(newFile)}`
}

// Why: reuse the parsed FileDiffMetadata across mounts so revisits / remounts /
// StrictMode skip the synchronous jsdiff pass entirely. Returning the shared
// reference is intentional — FileDiffMetadata is treated as immutable by Pierre.
// P7 (highlight priming) will read through this same cache, hence the export.
export function getOrParseDiffFromFiles(
  oldFile: FileContents,
  newFile: FileContents
): FileDiffMetadata {
  const key = parsedDiffCacheKey(oldFile, newFile)
  const cached = parsedDiffCache.get(key)
  if (cached) {
    // Refresh LRU recency on a hit (move-to-end via re-insert).
    setWithLRU(parsedDiffCache, key, cached, PARSED_DIFF_CACHE_MAX_ENTRIES)
    return cached
  }
  const parsed = parseDiffFromFile(oldFile, newFile)
  setWithLRU(parsedDiffCache, key, parsed, PARSED_DIFF_CACHE_MAX_ENTRIES)
  return parsed
}

export function resetParsedDiffCacheForTests(): void {
  parsedDiffCache.clear()
}
