import type { GitDiffResult } from '../../../../shared/types'

export type FileContent = {
  content: string
  isBinary: boolean
  isImage?: boolean
  mimeType?: string
  loadError?: string
}

// Why: content fingerprints computed once when the diff resolves (P6) so the
// DiffViewer cacheKey build and the EditorContent remount key reuse the hash
// instead of re-running FNV over full contents on every mount. Same double-FNV
// fingerprint embedded in the Pierre FileContents cacheKey, so the values line
// up. Only attached for text diffs (binary never reaches the hashing renderer).
export type DiffContentFingerprints = {
  original: string
  modified: string
}

export type DiffContent = GitDiffResult & {
  fingerprints?: DiffContentFingerprints
}
