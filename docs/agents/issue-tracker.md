# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in **`xipeng-jin/x1orca`** (the `origin` fork). Use the `gh` CLI for all operations.

> This clone has two remotes — `origin` (`xipeng-jin/x1orca`, the fork) and `upstream` (`stablyai/orca`). `gh` can resolve commands to upstream by default, so pass `-R xipeng-jin/x1orca` explicitly to keep issues on the fork.

## Conventions

- **Create an issue**: `gh issue create -R xipeng-jin/x1orca --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R xipeng-jin/x1orca --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list -R xipeng-jin/x1orca --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R xipeng-jin/x1orca --body "..."`
- **Apply / remove labels**: `gh issue edit <number> -R xipeng-jin/x1orca --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R xipeng-jin/x1orca --comment "..."`

Be mindful of the `gh` API rate limit — batch requests where possible and avoid unnecessary calls (per AGENTS.md).

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `xipeng-jin/x1orca`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R xipeng-jin/x1orca --comments`.
