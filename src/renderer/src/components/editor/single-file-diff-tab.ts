import type { OpenFile } from '@/store/slices/editor'

// Single-file diff tabs render through Pierre's CodeView (worker pool);
// combined-* diff tabs still render through Monaco and need no pool.
export function isSingleFileDiffTab(file: Pick<OpenFile, 'mode' | 'diffSource'>): boolean {
  return (
    file.mode === 'diff' &&
    file.diffSource !== undefined &&
    file.diffSource !== 'combined-uncommitted' &&
    file.diffSource !== 'combined-branch' &&
    file.diffSource !== 'combined-commit'
  )
}
