# Deploy Evidence Pack

- Generated: 2026-03-22T04:55:12.164Z
- Target: namecheap-portal
- Status: passed
- Base URL: https://portal.monsoonfire.com
- Commit: 9cc585b367832f85b82057e9424cf1458eb9ceae
- Branch: codex/1password-hardening

## Artifact Status

| Artifact | Required | Status | Path |
| --- | --- | --- | --- |
| Deploy preflight | no | pass | D:\tmp\mf-portal-firings-page\output\qa\deploy-preflight.json |
| Cutover verify | yes | pass | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-cutover-verify.json |
| Post-deploy promotion gate | yes | pass | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-promotion-gate.json |
| Post-deploy authenticated canary | no | pass | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-authenticated-canary.json |
| Post-deploy virtual staff regression | no | pass | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-virtual-staff-regression.json |
| Post-deploy Firestore index guard | no | pass | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-index-guard.json |
| Auto rollback report | no | unk | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-rollback.json |
| Post-rollback verify | no | pass | D:\tmp\mf-portal-firings-page\output\qa\post-deploy-rollback-verify.json |

## Notes

- This report is generated from local deploy artifacts and should be attached to release evidence.
- Use alongside CI artifacts for full production promotion traceability.

