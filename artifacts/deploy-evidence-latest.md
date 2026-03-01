# Deploy Evidence Pack

- Generated: 2026-03-01T17:25:26.126Z
- Target: namecheap-portal
- Status: passed
- Base URL: https://portal.monsoonfire.com
- Commit: 687397ba972b291197ad08478f1a5518f06618d1
- Branch: main

## Artifact Status

| Artifact | Required | Status | Path |
| --- | --- | --- | --- |
| Deploy preflight | no | pass | output/qa/deploy-preflight.json |
| Cutover verify | yes | pass | output/qa/post-deploy-cutover-verify.json |
| Post-deploy promotion gate | yes | pass | output/qa/post-deploy-promotion-gate.json |
| Post-deploy authenticated canary | no | pass | output/qa/post-deploy-authenticated-canary.json |
| Post-deploy virtual staff regression | no | pass | output/qa/post-deploy-virtual-staff-regression.json |
| Post-deploy Firestore index guard | no | pass | output/qa/post-deploy-index-guard.json |
| Auto rollback report | no | unk | output/qa/post-deploy-rollback.json |
| Post-rollback verify | no | pass | output/qa/post-deploy-rollback-verify.json |

## Notes

- This report is generated from local deploy artifacts and should be attached to release evidence.
- Use alongside CI artifacts for full production promotion traceability.

