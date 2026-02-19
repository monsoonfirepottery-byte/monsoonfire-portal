# Git Access and Repo Structure

Date: 2026-02-06

## Current State (this machine)
- Remote: `origin` uses HTTPS: `https://github.com/monsoonfirepottery-byte/monsoonfire-portal.git`.
- Credential helper: Git Credential Manager (`credential.helper=manager`) is configured via system gitconfig.
- Git identity (repo-local):
  - `user.name=Micah`
  - `user.email=monsoonfirepottery@gmail.com`
- GitHub CLI:
  - Installed at `C:\Program Files\GitHub CLI\gh.exe`.
  - Not currently on PATH for the existing shell session (restart terminal after install).

## Recommended Access Setup
1. Restart your terminal (so PATH picks up GitHub CLI).
2. Authenticate GitHub CLI:

```bash
gh auth login
```

If you prefer to keep everything in Git Credential Manager, use `git fetch`/`git push` and the normal prompt flow.

## Structure / Release Hygiene (alpha)
High signal items to keep CI and release branches sane:
- Ensure required untracked files are committed before cutting the alpha branch:
  - `.github/workflows/*.yml`
  - `docs/sprints/`, `tickets/`, and alpha evidence docs
  - `web/scripts/check-chunk-budgets.mjs`, `web/lighthouserc.json`, `web/src/lib/perf/*`, `web/src/views/*.test.ts`
- Keep local artifacts out of git history:
  - `firestore-debug.log`, `functions/firestore-debug.log`
  - `.npm-cache/`, `.npm-cache-web/`
  - `.lighthouseci/`, `tmp-firebase.json`

## Known Open Blockers
- Production drill requires a real staff Firebase ID token: `tickets/P0-alpha-drills-real-auth.md`.
- CI gates need real workflow runs with links in evidence pack: `tickets/P1-ci-gates-remediation.md`.
- iOS runtime verification requires macOS/Xcode: `tickets/P1-ios-runtime-macos-verification.md`.
