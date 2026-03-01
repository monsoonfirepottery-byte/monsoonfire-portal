# Policy Single Source of Truth - Website, Portal, and Reports

## Goal
Keep website policy content and portal/reports moderation enforcement on the same canonical policy version to prevent false "no active policy" states.

## Canonical Contract
1. Authoritative policy source files: `docs/policies/*.md`
2. Generated policy index for internal consumers: `docs/policies/policies-index.json`
3. Generated website policy payload: `website/data/policies.json`
4. Active moderation policy for portal/reports enforcement:
   - `config/moderationPolicy.activeVersion`
   - `moderationPolicyVersions/{version}`
5. Portal reports UI reads active policy via `getModerationPolicyCurrent`.

## Publish Workflow
1. Edit policy markdown in `docs/policies/*.md` (version/status/effectiveDate updates included).
2. Regenerate derived outputs:

```bash
node website/scripts/sync-policies.mjs
```

3. Publish/activate matching moderation policy version for reports module (`staffUpsertModerationPolicy`, then `staffPublishModerationPolicy`).
4. Verify portal/community shows the same active policy label/version returned by `getModerationPolicyCurrent`.
5. Merge only after parity checks pass.

## Lightweight Parity Checks
### Check A: docs index vs website data
Run this from repo root:

```bash
node -e 'const fs=require("fs");const docs=JSON.parse(fs.readFileSync("docs/policies/policies-index.json","utf8"));const web=JSON.parse(fs.readFileSync("website/data/policies.json","utf8"));const d=(docs.policies||[]).find((p)=>p.slug==="community-conduct");const w=(web.policies||[]).find((p)=>p.slug==="community-conduct");if(!d||!w)throw new Error("community-conduct missing in generated policy outputs");if(String(d.version)!==String(w.version))throw new Error(`version mismatch docs=${d.version} website=${w.version}`);console.log("ok: docs and website community-conduct versions match", d.version);'
```

### Check B: website data vs portal/reports active policy
1. Read website generated version for `community-conduct` from `website/data/policies.json`.
2. Read portal active policy version from `getModerationPolicyCurrent`.
3. Versions must match.

Example API probe (requires valid Firebase ID token):

```bash
curl -sS -X POST \
  "https://us-central1-monsoonfire-portal.cloudfunctions.net/getModerationPolicyCurrent" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{ok, version: .policy.version, title: .policy.title}'
```

## Rollback
1. Re-point `config/moderationPolicy.activeVersion` to last known good version.
2. Revert policy content commit if website output was incorrect.
3. Re-run both parity checks.
4. Confirm Community report modal label resolves to the restored policy version.

## Evidence Checklist
- [ ] `sync-policies` run completed
- [ ] docs vs website parity check passed
- [ ] active moderation policy version verified
- [ ] portal Community report policy label verified
- [ ] rollback version documented
