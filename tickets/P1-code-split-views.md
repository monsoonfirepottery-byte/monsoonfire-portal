Status: Completed (2026-02-05)

# P1 - Code-split portal views

- Repo: portal
- Area: Performance
- Evidence: `web/src/App.tsx` imports all views directly.
- Recommendation: `React.lazy` + `Suspense` for page-level chunks.
- Effort: M
- Risk: Low
- What to test: initial load, route transitions, error boundary fallback.
