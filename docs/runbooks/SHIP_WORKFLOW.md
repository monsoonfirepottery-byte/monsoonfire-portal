# Ship Workflow

## Purpose
Shorten the common close-out sequence of:
- merge the PR
- optionally deploy the right lane
- sync the safe default-branch worktree
- clean local artifacts

The workflow is intentionally safe by default:
- preview is the default mode
- merge happens remotely through GitHub so local worktree conflicts do not block it
- apply mode waits on required GitHub checks and fails fast if one of the long lanes turns red
- deploy only runs from a clean default-branch worktree
- cleanup runs last

## Commands
Preview the generic workflow for the current branch PR:

```bash
npm run ship
```

Apply the generic workflow:

```bash
npm run ship:apply
```

Preview the portal lane for a specific PR:

```bash
npm run ship:portal -- 473
```

Apply the portal lane:

```bash
npm run ship:portal:apply -- 473
```

When you want extra toggles through `npm run`, prefer npm-safe positional aliases:

```bash
npm run ship:apply -- 474 skip-cleanup
npm run ship:portal:apply -- 474 skip-cleanup skip-sync
```

Website and Studio Brain presets follow the same pattern:
- `npm run ship:website`
- `npm run ship:website:apply`
- `npm run ship:studio`
- `npm run ship:studio:apply`

## What it does
When apply mode is enabled, the workflow can:
1. verify `gh` auth
2. mark a draft PR ready
3. update a behind PR branch
4. wait for required GitHub checks to settle
5. merge the PR remotely
6. delete the remote branch
7. fetch/prune local refs
8. fast-forward a clean default-branch worktree
9. deploy the selected lane from that clean worktree
10. clean local artifacts

## Notes
- The workflow writes a JSON report to `output/maintenance/ship-workflow-latest.json` by default.
- The wait step uses `gh pr checks --required --watch --fail-fast`, so long GitHub lanes such as smoke, lighthouse, and mobile builds stay part of the ship instead of becoming a manual follow-up.
- If no clean default-branch worktree is available, deploy is blocked on purpose rather than deploying from a dirty feature branch.
- Direct `node ./scripts/ship-workflow.mjs ...` runs accept the full `--flag` syntax.
- Ship workflow npm shorthands also accept positional aliases like `apply`, `portal`, `474`, `skip-cleanup`, `skip-sync`, `skip-merge`, and `pr=474`.

## Studio Brain close-out

For Studio Brain deploy PRs, use the ship workflow as the close-out command after the PR exists:

```bash
npm run ship:studio -- 476
npm run ship:studio:apply -- 476
```

That sequence waits on GitHub, merges remotely, syncs a clean `main` worktree, then runs `studio:ops:reconcile` from the clean lane.
