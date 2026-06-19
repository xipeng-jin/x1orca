import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const DIFF_SCROLLER = '.pierre-diff-scroll'

type SeededStagedDiff = {
  absolutePath: string
  relativePath: string
  collapsedCommentId: string
}

async function enableRenderingPipeline(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.setBackgroundThrottling(false)
      win.show()
      win.focus()
    }
  })
}

async function seedStagedPierreDiff(page: Page, worktreeId: string): Promise<SeededStagedDiff> {
  return page.evaluate(async (wId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === wId)
    if (!worktree) {
      throw new Error('active worktree not found')
    }
    const separator = worktree.path.includes('\\') ? '\\' : '/'
    const relativePath = `src${separator}pierre-diff-comments.ts`
    const absolutePath = `${worktree.path}${separator}${relativePath}`
    const baseLines = Array.from(
      { length: 220 },
      (_, index) => `export const value${index + 1} = ${index + 1}`
    )

    await window.api.fs.writeFile({
      filePath: absolutePath,
      content: `${baseLines.join('\n')}\n`
    })
    await window.api.git.stage({ worktreePath: worktree.path, filePath: relativePath })
    const commit = await window.api.git.commit({
      worktreePath: worktree.path,
      message: 'Seed Pierre diff comments E2E base'
    })
    if (!commit.success) {
      throw new Error(commit.error ?? 'failed to commit seeded base file')
    }

    const modifiedLines = [...baseLines]
    modifiedLines[9] = 'export const value10 = 10_010'
    modifiedLines[189] = 'export const value190 = 190_190'
    await window.api.fs.writeFile({
      filePath: absolutePath,
      content: `${modifiedLines.join('\n')}\n`
    })
    await window.api.git.stage({ worktreePath: worktree.path, filePath: relativePath })
    state.setGitStatus(wId, await window.api.git.status({ worktreePath: worktree.path }))

    const collapsedComment = await state.addDiffComment({
      worktreeId: wId,
      filePath: relativePath,
      source: 'diff',
      lineNumber: 80,
      body: 'collapsed context note',
      side: 'modified'
    })
    if (!collapsedComment) {
      throw new Error('failed to seed collapsed diff comment')
    }

    state.openDiff(wId, absolutePath, relativePath, 'typescript', true)
    return {
      absolutePath,
      relativePath,
      collapsedCommentId: collapsedComment.id
    }
  }, worktreeId)
}

async function openSecondaryEditorTab(page: Page, worktreeId: string): Promise<void> {
  // Why: only the active editor file is mounted, so opening another tab fully
  // unmounts the Pierre diff — reproducing the fresh-mount path the user hits
  // when navigating back to a previously-scrolled diff via scroll-to-note.
  await page.evaluate(async (wId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === wId)
    if (!worktree) {
      throw new Error('active worktree not found')
    }
    const separator = worktree.path.includes('\\') ? '\\' : '/'
    const relativePath = `src${separator}pierre-diff-other.ts`
    const absolutePath = `${worktree.path}${separator}${relativePath}`
    await window.api.fs.writeFile({ filePath: absolutePath, content: 'export const other = 1\n' })
    state.openFile({
      filePath: absolutePath,
      relativePath,
      worktreeId: wId,
      language: 'typescript',
      mode: 'edit'
    })
  }, worktreeId)
}

async function waitForPierreStagedDiff(page: Page, relativePath: string): Promise<void> {
  await page.waitForFunction(
    ({ selector, suffix }) => {
      const state = window.__store?.getState()
      if (!state) {
        return false
      }
      const activeFileId = state.activeFileIdByWorktree?.[state.activeWorktreeId ?? ''] ?? ''
      const normalizedSuffix = suffix.replaceAll('\\', '/')
      const normalizedActive = activeFileId.replaceAll('\\', '/')
      const scroller = document.querySelector(selector)
      return (
        normalizedActive.endsWith(normalizedSuffix) &&
        scroller instanceof HTMLElement &&
        scroller.clientHeight > 0
      )
    },
    { selector: DIFF_SCROLLER, suffix: `::diff::staged::${relativePath}` },
    { polling: 100, timeout: 20_000 }
  )
}

async function clickAddGutterOnLine(page: Page, lineNumber: number): Promise<void> {
  const lineNumberBox = page
    .locator('diffs-container')
    .locator(`[data-additions] [data-column-number="${lineNumber}"]`)
    .first()
  await expect(lineNumberBox).toBeVisible({ timeout: 15_000 })
  await lineNumberBox.hover()
  const utilityButton = page.locator('diffs-container').locator('[data-utility-button]').first()
  await expect(utilityButton).toBeVisible({
    timeout: 5_000
  })
  await utilityButton.evaluate((button: HTMLElement) => {
    const rect = button.getBoundingClientRect()
    const init = {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }
    button.dispatchEvent(new PointerEvent('pointerdown', init))
    document.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }))
  })
}

function additionsLine(page: Page, lineNumber: number): Locator {
  return page
    .locator('diffs-container')
    .locator(`[data-additions] [data-column-number="${lineNumber}"]`)
    .first()
}

async function getViewportTop(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().top)
}

async function getViewportBottom(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().bottom)
}

async function getDiffCommentCount(page: Page, commentBody: string): Promise<number> {
  return page.evaluate((body) => {
    const store = window.__store
    if (!store) {
      return 0
    }
    return Object.values(store.getState().worktreesByRepo)
      .flat()
      .flatMap((worktree) => worktree.diffComments ?? [])
      .filter((comment) => comment.body === body).length
  }, commentBody)
}

async function isLocatorInViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    )
  })
}

async function scrollDiffAwayFromLocator(page: Page, locator: Locator): Promise<void> {
  const targetTop = await locator.evaluate((element) => element.getBoundingClientRect().top)
  const scrollTop = await page.locator(DIFF_SCROLLER).evaluate((element, top) => {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    const nextScrollTop = top > window.innerHeight / 2 ? 0 : maxScrollTop
    element.scrollTop = nextScrollTop
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return nextScrollTop
  }, targetTop)
  await page.waitForFunction(
    ({ selector, top }) => {
      const element = document.querySelector(selector)
      return element instanceof HTMLElement && Math.abs(element.scrollTop - top) <= 2
    },
    { selector: DIFF_SCROLLER, top: scrollTop },
    { polling: 100, timeout: 5_000 }
  )
}

async function openSourceControlNotes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().setRightSidebarOpen(true)
    store.getState().setRightSidebarTab('source-control')
  })

  const sourceControlPanel = page.getByTestId('source-control-panel')
  await expect(sourceControlPanel).toBeVisible({ timeout: 10_000 })
  const notesToggle = sourceControlPanel
    .locator('button[aria-expanded]')
    .filter({ hasText: 'Notes' })
    .first()
  await expect(notesToggle).toBeVisible({ timeout: 10_000 })
  if ((await notesToggle.getAttribute('aria-expanded')) !== 'true') {
    await notesToggle.click()
  }
}

test.describe('Pierre diff comments', () => {
  test('supports gutter add, chip expansion, card actions, and collapsed scroll reveal', async ({
    electronApp,
    orcaPage
  }) => {
    await enableRenderingPipeline(electronApp)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const seeded = await seedStagedPierreDiff(orcaPage, worktreeId)
    await waitForPierreStagedDiff(orcaPage, seeded.relativePath)

    await clickAddGutterOnLine(orcaPage, 10)
    const popover = orcaPage.locator('.orca-diff-comment-popover-static')
    await expect(popover).toBeVisible({ timeout: 10_000 })
    await expect(popover.locator('.orca-diff-comment-popover-label')).toHaveText('Line 10')

    // Why: the add-note popover must open below the commented line so the user
    // can still read line 10 while writing the note (multi-line end-line anchoring
    // is covered by pierre-diff-comment-code-view unit tests).
    const targetLineBottom = await getViewportBottom(additionsLine(orcaPage, 10))
    const popoverTop = await getViewportTop(popover)
    expect(
      popoverTop,
      'add-note popover should open below the commented line instead of covering it'
    ).toBeGreaterThanOrEqual(targetLineBottom - 1)

    const addedBody = 'note added from Pierre gutter'
    await popover.locator('.orca-diff-comment-popover-textarea').fill(addedBody)
    await popover.getByRole('button', { name: 'Add note' }).click()
    await expect
      .poll(() => getDiffCommentCount(orcaPage, addedBody), {
        timeout: 10_000,
        message: 'Pierre gutter add did not persist a diff comment'
      })
      .toBe(1)

    const expandedAddedCard = orcaPage
      .locator('.orca-diff-comment-card')
      .filter({ hasText: addedBody })
      .first()
    await expect(expandedAddedCard).toBeVisible({ timeout: 10_000 })
    await expect(expandedAddedCard.getByTitle('Edit note')).toBeVisible()
    await expect(expandedAddedCard.getByTitle('Delete note')).toBeVisible()
    await expect(expandedAddedCard.getByTitle('Send notes to an agent')).toBeVisible()

    // Why: Pierre renders annotation controls through a slot/portal inside the
    // custom element; Playwright hit-testing reports the host as the interceptor.
    await expandedAddedCard
      .getByTitle('Edit note')
      .evaluate((button: HTMLButtonElement) => button.click())
    await expect(expandedAddedCard.locator('.orca-diff-comment-popover-textarea')).toHaveValue(
      addedBody
    )
    await expandedAddedCard
      .getByRole('button', { name: 'Cancel' })
      .evaluate((button: HTMLButtonElement) => button.click())

    await openSourceControlNotes(orcaPage)
    const sourceControlPanel = orcaPage.getByTestId('source-control-panel')
    const sourceControlCollapsedNote = sourceControlPanel.locator('li').filter({
      hasText: 'collapsed context note'
    })
    await expect(sourceControlCollapsedNote).toBeVisible({ timeout: 10_000 })
    await sourceControlCollapsedNote.hover()

    const scrollToNoteButton = sourceControlPanel.getByRole('button', {
      name: 'Scroll to note on line 80'
    })
    await expect
      .poll(() => scrollToNoteButton.evaluate((button) => getComputedStyle(button).opacity), {
        timeout: 5_000,
        message: 'Source Control scroll-to-note button did not reveal on row hover'
      })
      .toBe('1')
    await scrollToNoteButton.click()

    const revealedCard = orcaPage
      .locator('.orca-diff-comment-card')
      .filter({ hasText: 'collapsed context note' })
      .first()
    await expect(revealedCard).toBeVisible({ timeout: 15_000 })
    await expect(revealedCard.locator('.orca-diff-comment-body')).toHaveText(
      'collapsed context note'
    )

    await scrollDiffAwayFromLocator(orcaPage, revealedCard)
    await expect
      .poll(() => isLocatorInViewport(revealedCard), {
        timeout: 10_000,
        message: 'Seeded note stayed in the viewport after manual diff scroll'
      })
      .toBe(false)

    await sourceControlCollapsedNote.hover()
    await expect
      .poll(() => scrollToNoteButton.evaluate((button) => getComputedStyle(button).opacity), {
        timeout: 5_000,
        message: 'Source Control scroll-to-note button did not reveal on repeated row hover'
      })
      .toBe('1')
    // Why: tag the live Pierre scroller so we can prove the scroll-to-note click
    // does NOT remount the CodeView. A reopen would bump diffContentReloadNonce,
    // rotate the DiffViewer key, and replace this node — which races the scroll
    // restore and the scroll-to-note poll, the real-world "nothing happens" bug.
    await orcaPage.locator(DIFF_SCROLLER).evaluate((element) => {
      element.setAttribute('data-scroll-to-note-probe', '1')
    })
    await scrollToNoteButton.click()
    await expect
      .poll(() => isLocatorInViewport(revealedCard), {
        timeout: 15_000,
        message: 'Repeated Source Control scroll-to-note click did not reveal the note'
      })
      .toBe(true)
    await expect(
      orcaPage.locator(`${DIFF_SCROLLER}[data-scroll-to-note-probe="1"]`),
      'scroll-to-note remounted the Pierre diff instead of scrolling the live one'
    ).toHaveCount(1)

    // Navigate away to another editor tab so the diff fully unmounts, leave the
    // note off-screen, then prove scroll-to-note re-mounts the diff and scrolls
    // to the note instead of restoring the stale pre-navigation position.
    await scrollDiffAwayFromLocator(orcaPage, revealedCard)
    await expect
      .poll(() => isLocatorInViewport(revealedCard), {
        timeout: 10_000,
        message: 'Seeded note stayed in the viewport before navigating away'
      })
      .toBe(false)
    await openSecondaryEditorTab(orcaPage, worktreeId)
    await expect(orcaPage.locator(DIFF_SCROLLER)).toHaveCount(0)

    await sourceControlCollapsedNote.hover()
    await expect
      .poll(() => scrollToNoteButton.evaluate((button) => getComputedStyle(button).opacity), {
        timeout: 5_000,
        message: 'Source Control scroll-to-note button did not reveal after navigating away'
      })
      .toBe('1')
    await scrollToNoteButton.click()
    await expect(orcaPage.locator(DIFF_SCROLLER)).toHaveCount(1)
    await expect
      .poll(() => isLocatorInViewport(revealedCard), {
        timeout: 15_000,
        message: 'scroll-to-note did not reveal the note after navigating back to the diff'
      })
      .toBe(true)
  })
})
