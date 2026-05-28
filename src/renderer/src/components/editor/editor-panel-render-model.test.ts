import { describe, expect, it } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import { getEditorPanelRenderModel } from './editor-panel-render-model'

function createOpenFile(overrides: Partial<OpenFile>): OpenFile {
  return {
    id: 'file-1',
    filePath: '/repo/src/app.ts',
    relativePath: 'src/app.ts',
    worktreeId: 'repo::/repo',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  } as OpenFile
}

describe('getEditorPanelRenderModel', () => {
  it('keeps the diff layout toggle available for dedicated single-file diff tabs', () => {
    const model = getEditorPanelRenderModel({
      activeFile: createOpenFile({
        id: 'diff-1',
        mode: 'diff',
        diffSource: 'unstaged'
      }),
      fileContents: {},
      gitStatusByWorktree: {},
      gitBranchChangesByWorktree: {},
      markdownViewMode: {},
      isChangesMode: false
    })

    expect(model.isSingleDiff).toBe(true)
    expect(model.isDiffSurface).toBe(true)
    expect(model.isCombinedDiff).toBe(false)
  })

  it('does not mark normal edit tabs as diff surfaces', () => {
    const model = getEditorPanelRenderModel({
      activeFile: createOpenFile({ mode: 'edit' }),
      fileContents: {},
      gitStatusByWorktree: {},
      gitBranchChangesByWorktree: {},
      markdownViewMode: {},
      isChangesMode: false
    })

    expect(model.isSingleDiff).toBe(false)
    expect(model.isDiffSurface).toBe(false)
  })
})
