# Deploy Evidence Pack

- Generated: 2026-03-01T01:30:24.542Z
- Target: namecheap-portal
- Status: passed
- Base URL: https://portal.monsoonfire.com
- Commit: 3cb498386d9bf3e05166dc57ca043138df33573c
- Branch: main

## Artifact Status

| Artifact | Required | Status | Path |
| --- | --- | --- | --- |
| Deploy preflight | no | pass | output/qa/deploy-preflight.json |
| Cutover verify | yes | pass | output/qa/post-deploy-cutover-verify.json |
| Post-deploy promotion gate | no | miss | output/qa/post-deploy-promotion-gate.json |
| Post-deploy authenticated canary | no | miss | output/qa/post-deploy-authenticated-canary.json |
| Post-deploy virtual staff regression | no | miss | output/qa/post-deploy-virtual-staff-regression.json |
| Post-deploy Firestore index guard | no | miss | output/qa/post-deploy-index-guard.json |
| Auto rollback report | no | miss | output/qa/post-deploy-rollback.json |
| Post-rollback verify | no | miss | output/qa/post-deploy-rollback-verify.json |

## Notes

- This report is generated from local deploy artifacts and should be attached to release evidence.
- Use alongside CI artifacts for full production promotion traceability.

