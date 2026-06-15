import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContents, FileDiffMetadata } from '@pierre/diffs'

const parseDiffFromFile = vi.hoisted(() => vi.fn())

vi.mock('@pierre/diffs', () => ({ parseDiffFromFile }))

import {
  getOrParseDiffFromFiles,
  resetParsedDiffCacheForTests,
  PARSED_DIFF_CACHE_MAX_ENTRIES
} from './parsed-diff-cache'

function makeFile(name: string, contents: string, cacheKey: string): FileContents {
  return { name, contents, cacheKey }
}

function makeMetadata(cacheKey: string): FileDiffMetadata {
  return { cacheKey, name: 'metadata' } as unknown as FileDiffMetadata
}

beforeEach(() => {
  resetParsedDiffCacheForTests()
  parseDiffFromFile.mockReset()
  parseDiffFromFile.mockImplementation((oldFile: FileContents, newFile: FileContents) =>
    makeMetadata(`diff:${oldFile.cacheKey}:${newFile.cacheKey}`)
  )
})

describe('getOrParseDiffFromFiles', () => {
  it('parses once and returns the cached metadata for identical old/new content', () => {
    const first = getOrParseDiffFromFiles(
      makeFile('a.ts', 'old', 'k:old'),
      makeFile('a.ts', 'new', 'k:new')
    )
    // A fresh FileContents pair with the same cache keys (a remount) is a hit.
    const second = getOrParseDiffFromFiles(
      makeFile('a.ts', 'old', 'k:old'),
      makeFile('a.ts', 'new', 'k:new')
    )

    expect(parseDiffFromFile).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('re-parses when the modified side changes', () => {
    const oldFile = makeFile('a.ts', 'old', 'k:old')
    getOrParseDiffFromFiles(oldFile, makeFile('a.ts', 'new', 'k:new'))
    getOrParseDiffFromFiles(oldFile, makeFile('a.ts', 'new2', 'k:new2'))

    expect(parseDiffFromFile).toHaveBeenCalledTimes(2)
  })

  it('re-parses when only the original side changes (git add path)', () => {
    const newFile = makeFile('a.ts', 'new', 'k:new')
    getOrParseDiffFromFiles(makeFile('a.ts', 'old', 'k:old'), newFile)
    getOrParseDiffFromFiles(makeFile('a.ts', 'old2', 'k:old2'), newFile)

    expect(parseDiffFromFile).toHaveBeenCalledTimes(2)
  })

  it('re-parses a rename when only the file name in the cache key changes', () => {
    const newFile = makeFile('a.ts', 'new', 'k:new')
    // Same contents and same fingerprint segment on the original side; the cache
    // keys differ only by the embedded file name — a pure rename must still miss
    // (cacheKey carries the name, so a content-only key would wrongly hit here).
    getOrParseDiffFromFiles(makeFile('old.ts', 'same', 'fp:old.ts:typescript:abc'), newFile)
    getOrParseDiffFromFiles(makeFile('renamed.ts', 'same', 'fp:renamed.ts:typescript:abc'), newFile)

    expect(parseDiffFromFile).toHaveBeenCalledTimes(2)
  })

  it('evicts the least-recently-used parse past the cap', () => {
    // Insert one more than the cap so the first-inserted entry is evicted.
    for (let i = 0; i <= PARSED_DIFF_CACHE_MAX_ENTRIES; i += 1) {
      getOrParseDiffFromFiles(
        makeFile('f.ts', `o${i}`, `ko:${i}`),
        makeFile('f.ts', `m${i}`, `km:${i}`)
      )
    }
    expect(parseDiffFromFile).toHaveBeenCalledTimes(PARSED_DIFF_CACHE_MAX_ENTRIES + 1)

    // Entry 0 was the oldest and never re-accessed → evicted → re-parses.
    getOrParseDiffFromFiles(makeFile('f.ts', 'o0', 'ko:0'), makeFile('f.ts', 'm0', 'km:0'))
    expect(parseDiffFromFile).toHaveBeenCalledTimes(PARSED_DIFF_CACHE_MAX_ENTRIES + 2)

    // The most recently inserted entry is still cached → no re-parse.
    getOrParseDiffFromFiles(
      makeFile('f.ts', `o${PARSED_DIFF_CACHE_MAX_ENTRIES}`, `ko:${PARSED_DIFF_CACHE_MAX_ENTRIES}`),
      makeFile('f.ts', `m${PARSED_DIFF_CACHE_MAX_ENTRIES}`, `km:${PARSED_DIFF_CACHE_MAX_ENTRIES}`)
    )
    expect(parseDiffFromFile).toHaveBeenCalledTimes(PARSED_DIFF_CACHE_MAX_ENTRIES + 2)
  })

  it('refreshes recency on a hit so a recently-read entry survives eviction', () => {
    const survivor = (): FileDiffMetadata =>
      getOrParseDiffFromFiles(makeFile('s.ts', 'so', 'ks:o'), makeFile('s.ts', 'sn', 'ks:n'))
    survivor()
    // Fill the rest of the cap with distinct entries, re-reading the survivor
    // before the final inserts so it stays most-recent.
    for (let i = 0; i < PARSED_DIFF_CACHE_MAX_ENTRIES - 1; i += 1) {
      getOrParseDiffFromFiles(
        makeFile('f.ts', `o${i}`, `ko:${i}`),
        makeFile('f.ts', `m${i}`, `km:${i}`)
      )
    }
    survivor() // refresh recency (still a hit)
    // Insert two more distinct entries → evicts the two oldest, not the survivor.
    getOrParseDiffFromFiles(makeFile('f.ts', 'oX', 'ko:X'), makeFile('f.ts', 'mX', 'km:X'))
    getOrParseDiffFromFiles(makeFile('f.ts', 'oY', 'ko:Y'), makeFile('f.ts', 'mY', 'km:Y'))

    const callsBefore = parseDiffFromFile.mock.calls.length
    survivor()
    expect(parseDiffFromFile).toHaveBeenCalledTimes(callsBefore)
  })

  it('falls back to a name+fingerprint key when a cache key is missing', () => {
    const oldNoKey: FileContents = { name: 'a.ts', contents: 'old' }
    const newNoKey: FileContents = { name: 'a.ts', contents: 'new' }
    getOrParseDiffFromFiles(oldNoKey, newNoKey)
    getOrParseDiffFromFiles({ name: 'a.ts', contents: 'old' }, { name: 'a.ts', contents: 'new' })
    // Same name + content → hit despite absent cacheKey.
    expect(parseDiffFromFile).toHaveBeenCalledTimes(1)

    // A content change with no cacheKey still misses (fingerprint differs).
    getOrParseDiffFromFiles(oldNoKey, { name: 'a.ts', contents: 'new3' })
    expect(parseDiffFromFile).toHaveBeenCalledTimes(2)
  })
})
