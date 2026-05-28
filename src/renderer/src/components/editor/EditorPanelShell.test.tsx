import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'

vi.mock('@/store', () => ({
  useAppStore: Object.assign(() => ({}), {
    getState: () => ({ worktreesByRepo: {} })
  })
}))

vi.mock('./EditorPanelHeader', () => ({
  EditorPanelHeader: () => <header data-testid="editor-header" />
}))

vi.mock('./EditorContent', () => ({
  EditorContent: () => <main data-testid="editor-content" />
}))

vi.mock('./UntitledFileRenameDialog', () => ({
  UntitledFileRenameDialog: () => null
}))

vi.mock('./PierreDiffWorkerPoolProvider', () => ({
  PierreDiffWorkerPoolProvider: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="pierre-worker-provider">{children}</section>
  )
}))

import { EditorPanelShell } from './EditorPanelShell'

function createOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
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

function createRenderModel(overrides: Record<string, unknown> = {}) {
  return {
    isCombinedDiff: false,
    isSingleDiff: false,
    isDiffSurface: false,
    isMarkdown: false,
    isCsv: false,
    isNotebook: false,
    hasEditorToggle: false,
    availableEditorToggleModes: ['edit'],
    effectiveToggleValue: 'edit',
    mdViewMode: 'source',
    hasViewModeToggle: false,
    canOpenPreviewToSide: false,
    canShowMarkdownPreview: false,
    canShowMarkdownTableOfContents: false,
    isMarkdownTableOfContentsDisabled: false,
    openFileState: { canOpen: true },
    worktreeEntries: [],
    resolvedLanguage: 'typescript',
    isMermaid: false,
    ...overrides
  }
}

function renderShell(modelOverrides: Record<string, unknown>): string {
  const activeFile = createOpenFile({
    mode: modelOverrides.isSingleDiff ? 'diff' : 'edit',
    diffSource: modelOverrides.isSingleDiff ? 'unstaged' : undefined
  })

  return renderToStaticMarkup(
    <EditorPanelShell
      panelRef={React.createRef<HTMLDivElement>()}
      activeFile={activeFile}
      activeViewStateId={activeFile.id}
      model={createRenderModel(modelOverrides) as never}
      copiedPathVisible={false}
      showMarkdownTableOfContents={false}
      sideBySide={false}
      openFiles={[activeFile]}
      fileContents={{}}
      diffContents={{}}
      editorDrafts={{}}
      pendingEditorReveal={null}
      renameDialogFile={null}
      renameError={null}
      disableRenameBrowse={false}
      onCopyPath={vi.fn()}
      onOpenDiffTargetFile={vi.fn()}
      onOpenPreviewToSide={vi.fn()}
      onOpenMarkdownPreview={vi.fn()}
      onOpenContainingFolder={vi.fn()}
      onToggleSideBySide={vi.fn()}
      onEditorToggleChange={vi.fn()}
      onToggleMarkdownTableOfContents={vi.fn()}
      onExportMarkdownToPdf={vi.fn()}
      onContentChange={vi.fn()}
      onContentChangeForFile={vi.fn()}
      onDirtyStateHint={vi.fn()}
      onSave={vi.fn()}
      onSaveForFile={vi.fn()}
      onReloadFileContent={vi.fn()}
      onCloseMarkdownTableOfContents={vi.fn()}
      onCloseRenameDialog={vi.fn()}
      onRenameConfirm={vi.fn()}
    />
  )
}

describe('EditorPanelShell', () => {
  it('scopes the Pierre worker provider to dedicated single-file diff tabs', () => {
    expect(renderShell({ isSingleDiff: true, isDiffSurface: true })).toContain(
      'data-testid="pierre-worker-provider"'
    )
  })

  it('does not mount the Pierre worker provider for non-Pierre editor surfaces', () => {
    expect(renderShell({ isSingleDiff: false, isDiffSurface: false })).not.toContain(
      'data-testid="pierre-worker-provider"'
    )
    expect(renderShell({ isCombinedDiff: true, isDiffSurface: true })).not.toContain(
      'data-testid="pierre-worker-provider"'
    )
  })
})
