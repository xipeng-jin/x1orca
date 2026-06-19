# Context Glossary

Canonical terms for Git diff rendering surfaces. Glossary only — no implementation
details, no decisions. Decisions live in `docs/adr/`; rendering internals in the code.

## Diff surfaces

- **Single-file diff** — one file's changes shown in a dedicated editor tab. Already
  rendered with Pierre (`@pierre/diffs` `CodeView`). Sources: `unstaged`, `staged`,
  `branch`, `commit`.
- **Combined diff** — many files' changes shown together in one tab, one section per
  file. Sources: `combined-uncommitted`, `combined-branch`, `combined-commit`.
- **Read-only diff** — a diff opened for viewing; neither side is editable. Both
  single-file and combined diffs above are read-only.
- **Editable diff (Changes mode)** — a single-file HEAD-vs-working-tree diff where the
  modified side is an editable buffer. Distinct from read-only diffs; not interchangeable
  with them.

## Sidebar actions

- **View all** — Source Control action that opens a combined diff tab for a section
  (`CHANGES` / `STAGED CHANGES` / `UNTRACKED`, or `Committed on Branch`).
- **Commit row** — a row under `COMMITS` in Git history; opening it shows that commit's
  message plus a combined diff of its changed files.

## Annotations

- **Diff comment** — a line-anchored comment attached to a position in a diff (review
  feedback). Anchored to the **modified side** of the diff (the new/added version of the
  file); a comment may span a line range. Authored on a single-file diff and persisted
  per worktree.
- **Comment chip** — the collapsed inline marker shown on a commented line in a
  single-file diff. Expands in place to the full comment card; distinct from the
  card's expanded state.
- **Add-comment popover** — the transient input surface for composing a new diff comment,
  opened from the line's add affordance.
- **Collapsed unchanged region** — a run of unchanged lines a diff hides behind an
  expander instead of showing inline. A diff comment may exist on a line inside one, in
  which case it shows no comment chip until the region is revealed.
- **Auto-reveal** — scroll-to-note behavior that, when a diff comment's anchor line sits in
  a collapsed unchanged region, expands that region and opens the card, rather than leaving
  the comment reachable only from the sidebar.
