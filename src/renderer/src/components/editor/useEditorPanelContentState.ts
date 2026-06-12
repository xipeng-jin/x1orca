import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import { fetchEditorDiffContent, fetchEditorFileContent } from './editor-content-fetch'
import { canUseChangesModeForFile } from './editor-panel-file-mode'
import {
  isReloadableSingleFileDiffTab,
  shouldReloadDiffOnGitStatusChange
} from './editor-panel-diff-reload'
import {
  useEditorPanelExternalContentEvents,
  usePruneClosedEditorContent
} from './useEditorPanelExternalContentEvents'
import { useEditorPanelFileLoadRetry } from './useEditorPanelFileLoadRetry'

type GitStatusByWorktree = ReturnType<typeof useAppStore.getState>['gitStatusByWorktree']
type EditorViewModeByFile = ReturnType<typeof useAppStore.getState>['editorViewMode']

type UseEditorPanelContentStateParams = {
  activeFile: OpenFile | null
  isChangesMode: boolean
  openFiles: OpenFile[]
  gitStatusByWorktree: GitStatusByWorktree
  editorViewMode: EditorViewModeByFile
}

type UseEditorPanelContentStateResult = {
  fileContents: Record<string, FileContent>
  diffContents: Record<string, DiffContent>
  reloadFileContent: (file: OpenFile) => void
}

export function useEditorPanelContentState({
  activeFile,
  isChangesMode,
  openFiles,
  gitStatusByWorktree,
  editorViewMode
}: UseEditorPanelContentStateParams): UseEditorPanelContentStateResult {
  const [fileContents, setFileContents] = useState<Record<string, FileContent>>({})
  const [diffContents, setDiffContents] = useState<Record<string, DiffContent>>({})
  const diffContentsRef = useRef(diffContents)
  diffContentsRef.current = diffContents
  const fileLoadRetryAttemptsRef = useRef<Record<string, number>>({})
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles
  const editorViewModeRef = useRef(editorViewMode)
  editorViewModeRef.current = editorViewMode
  const selectedConflictReviewFile =
    activeFile?.mode === 'conflict-review' && activeFile.conflictReview?.selectedFileId
      ? (openFiles.find((file) => file.id === activeFile.conflictReview?.selectedFileId) ?? null)
      : null

  const loadFileContent = useCallback(
    async (
      filePath: string,
      id: string,
      worktreeId?: string,
      relativePath?: string,
      options?: { force?: boolean }
    ): Promise<void> => {
      try {
        const connectionId = getConnectionId(worktreeId ?? null) ?? undefined
        const restoredOpenFile = openFilesRef.current.find((file) => file.id === id)
        const activeSettings = useAppStore.getState().settings
        const readSettings = settingsForRuntimeOwner(
          activeSettings,
          restoredOpenFile?.runtimeEnvironmentId
        )
        if (restoredOpenFile?.filePath === filePath && restoredOpenFile.relativePath === filePath) {
          if (readSettings?.activeRuntimeEnvironmentId?.trim() || connectionId) {
            // Why: restored external-file tabs contain client-local absolute
            // paths. Remote runtime and SSH workspaces cannot read those paths
            // without an explicit upload/import flow.
            throw new Error('External local files are not available for remote workspaces.')
          }
          // Why: restored external-file tabs need their main-process path grant
          // refreshed because that authorization is only held in memory.
          await window.api.fs.authorizeExternalPath({ targetPath: filePath })
        }
        const result = await fetchEditorFileContent(
          {
            settings: readSettings,
            filePath,
            relativePath: restoredOpenFile?.relativePath ?? relativePath,
            worktreeId,
            connectionId
          },
          options
        )
        delete fileLoadRetryAttemptsRef.current[id]
        setFileContents((prev) => ({ ...prev, [id]: result }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setFileContents((prev) => ({
          ...prev,
          [id]: { content: '', isBinary: false, loadError: message }
        }))
      }
    },
    []
  )

  const loadDiffContent = useCallback(
    async (file: OpenFile | null, options?: { force?: boolean }): Promise<void> => {
      if (!file || (file.mode === 'edit' && !canUseChangesModeForFile(file))) {
        return
      }
      try {
        const result = await fetchEditorDiffContent(file, options)
        setDiffContents((prev) => ({ ...prev, [file.id]: result }))
      } catch (err) {
        setDiffContents((prev) => ({
          ...prev,
          [file.id]: {
            kind: 'text',
            originalContent: '',
            modifiedContent: `Error loading diff: ${err}`,
            originalIsBinary: false,
            modifiedIsBinary: false
          }
        }))
      }
    },
    []
  )

  const reloadFileContent = useCallback(
    (file: OpenFile): void => {
      delete fileLoadRetryAttemptsRef.current[file.id]
      setFileContents((prev) => {
        if (!prev[file.id]) {
          return prev
        }
        const next = { ...prev }
        delete next[file.id]
        return next
      })
      // Why: an explicit reload must bypass a still-in-flight read that may
      // hold stale content now that in-flight entries live for the whole RPC.
      void loadFileContent(file.filePath, file.id, file.worktreeId, file.relativePath, {
        force: true
      })
    },
    [loadFileContent]
  )

  useEffect(() => {
    if (activeFile?.mode === 'conflict-review' && !selectedConflictReviewFile) {
      const snapshotEntries = activeFile.conflictReview?.entries ?? []
      if (snapshotEntries.length === 0) {
        return
      }

      const snapshotPaths = new Set(snapshotEntries.map((entry) => entry.path))
      const liveEntries = gitStatusByWorktree[activeFile.worktreeId] ?? []
      for (const entry of liveEntries) {
        if (
          !snapshotPaths.has(entry.path) ||
          entry.conflictStatus !== 'unresolved' ||
          !entry.conflictKind ||
          entry.status === 'deleted'
        ) {
          continue
        }

        const absolutePath = joinPath(activeFile.filePath, entry.path)
        if (!fileContents[absolutePath]) {
          void loadFileContent(absolutePath, absolutePath, activeFile.worktreeId, entry.path)
        }
      }
      return
    }

    const fileToLoad = selectedConflictReviewFile ?? activeFile
    if (!fileToLoad || (activeFile?.mode === 'conflict-review' && !selectedConflictReviewFile)) {
      return
    }
    if (fileToLoad.mode === 'edit' || fileToLoad.mode === 'markdown-preview') {
      if (fileToLoad.conflict?.kind === 'conflict-placeholder') {
        return
      }
      if (!fileContents[fileToLoad.id]) {
        void loadFileContent(fileToLoad.filePath, fileToLoad.id, fileToLoad.worktreeId)
      }
      if (isChangesMode && !diffContents[fileToLoad.id]) {
        void loadDiffContent(fileToLoad)
      }
    } else if (isReloadableSingleFileDiffTab(fileToLoad) && !diffContents[fileToLoad.id]) {
      void loadDiffContent(fileToLoad)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeFile?.id,
    activeFile?.mode,
    activeFile?.conflictReview?.selectedFileId,
    activeFile?.conflictReview?.snapshotTimestamp,
    selectedConflictReviewFile?.id,
    isChangesMode,
    gitStatusByWorktree
  ])

  useEditorPanelFileLoadRetry({
    activeFile,
    fileContents,
    fileLoadRetryAttemptsRef,
    loadFileContent,
    openFilesRef,
    setFileContents
  })

  const changesStatusEntries = activeFile?.worktreeId
    ? gitStatusByWorktree[activeFile.worktreeId]
    : undefined
  const activeFileGitStatusSignature = useMemo(() => {
    if (!activeFile?.relativePath || !changesStatusEntries) {
      return ''
    }
    const matching = changesStatusEntries.filter((entry) => entry.path === activeFile.relativePath)
    return JSON.stringify(
      matching.map((entry) => ({
        area: entry.area,
        status: entry.status,
        conflictStatus: entry.conflictStatus
      }))
    )
  }, [activeFile?.relativePath, changesStatusEntries])
  useEffect(() => {
    if (!activeFile?.id) {
      return
    }
    const current = openFilesRef.current.find((f) => f.id === activeFile.id)
    if (!current) {
      return
    }
    if (!(isChangesMode || shouldReloadDiffOnGitStatusChange(current))) {
      return
    }
    // Why: the lazy-load effect already fetches on first open; forcing here
    // races a duplicate git-diff RPC for the same tab.
    if (!diffContentsRef.current[current.id]) {
      return
    }
    void loadDiffContent(current, { force: true })
  }, [activeFileGitStatusSignature, isChangesMode, activeFile?.id, loadDiffContent])

  useEffect(() => {
    const nonce = activeFile?.diffContentReloadNonce
    if (!activeFile?.id || nonce === undefined || nonce === 0) {
      return
    }
    const current = openFilesRef.current.find((f) => f.id === activeFile.id)
    if (!current || !isReloadableSingleFileDiffTab(current)) {
      return
    }
    setDiffContents((prev) => {
      if (!prev[current.id]) {
        return prev
      }
      const next = { ...prev }
      delete next[current.id]
      return next
    })
    void loadDiffContent(current, { force: true })
  }, [activeFile?.diffContentReloadNonce, activeFile?.id, loadDiffContent])

  useEffect(() => {
    const nonce = activeFile?.fileContentReloadNonce
    if (!activeFile?.id || nonce === undefined || nonce === 0) {
      return
    }
    const current = openFilesRef.current.find((f) => f.id === activeFile.id)
    if (
      !current ||
      current.isDirty ||
      (current.mode !== 'edit' && current.mode !== 'markdown-preview')
    ) {
      return
    }
    setFileContents((prev) => {
      if (!prev[current.id]) {
        return prev
      }
      const next = { ...prev }
      delete next[current.id]
      return next
    })
    void loadFileContent(current.filePath, current.id, current.worktreeId, current.relativePath)
  }, [activeFile?.fileContentReloadNonce, activeFile?.filePath, activeFile?.id, loadFileContent])

  useEditorPanelExternalContentEvents({
    loadDiffContent,
    loadFileContent,
    openFilesRef,
    editorViewModeRef,
    setFileContents,
    setDiffContents
  })
  usePruneClosedEditorContent(openFiles, fileLoadRetryAttemptsRef, setFileContents, setDiffContents)

  return { fileContents, diffContents, reloadFileContent }
}
