Status: Completed

# P1 - Refresh staff claims on token change

- Repo: portal
- Area: Security
- Evidence: `web/src/App.tsx` uses `onAuthStateChanged` only.
- Recommendation: use `onIdTokenChanged` / `idTokenChanges` for staff claim refresh without sign-out.
- Effort: S
- Risk: Low
- What to test: change staff claim and verify UI updates after token refresh.
