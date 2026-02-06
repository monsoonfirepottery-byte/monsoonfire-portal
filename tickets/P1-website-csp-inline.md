Status: Completed (2026-02-05)

# P1 - Remove unsafe-inline by externalizing website scripts

- Repo: website
- Area: Security
- Evidence: `website/index.html` uses inline GA/Metricool scripts; CSP in `website/web.config` allows `unsafe-inline`.
- Recommendation: move inline scripts to external files + add CSP nonces/hashes.
- Effort: M
- Risk: Low
- What to test: analytics still fire; CSP no longer requires unsafe-inline.
