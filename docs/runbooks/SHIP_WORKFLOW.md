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
4. wait for checks
5. merge the PR remotely
6. delete the remote branch
7. fetch/prune local refs
8. fast-forward a clean default-branch worktree
9. deploy the selected lane from that clean worktree
10. clean local artifacts

## Notes
- The workflow writes a JSON report to `output/maintenance/ship-workflow-latest.json` by default.
- If no clean default-branch worktree is available, deploy is blocked on purpose rather than deploying from a dirty feature branch.
- Use `--skip-deploy`, `--skip-sync`, or `--skip-cleanup` when you only want part of the tail-end flow.
