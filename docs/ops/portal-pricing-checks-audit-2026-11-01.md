# Portal pricing release checks

The November 1 pricing release applies version 2 only to future tickets. Existing
tickets retain their recorded or legacy prices. These checks do not submit a
ticket, send an invoice, or alter a billed amount.

The authenticated canary now follows the deployed Studio desk, billing overview,
and Start here navigation. Check-in previews and My Pieces previews share a CSS
class, so the piece-detail check selects the explicit My Pieces accessible label.
Staff ticket verification waits for loading to finish before capturing evidence.

The sign-in test bootstrap accepts only a configured API key, the exact Firebase
password endpoint, a POST request, and the intended staff email. Service workers
are blocked in its isolated browser context so request interception is reliable.
Unit tests cover the intended request and reject unrelated keys, accounts,
missing email, other hosts, and GET requests. The index-deploy wrapper uses the
installed Firebase CLI through Node when available instead of requiring npx.

Validation commands (run from the repository root with configured local credentials):

```sh
node --test scripts/portal-authenticated-canary-auth.test.mjs scripts/lib/command-runner.test.mjs scripts/lib/portal-authenticated-canary-state.test.mjs
node scripts/verify-pricing-release.mjs --output-dir output/qa/pricing-audit
node scripts/post-deploy-promotion-gate.mjs --skip-index-deploy --skip-journey-check --report output/qa/promotion-audit.json --json
```

The index contract guard still runs. Index deployment is excluded because this
release needs no index changes; the journey check is excluded because it creates
records. Theme sweeps and virtual staff backend regression remain enabled.
The pricing verifier checks authenticated live whole-kiln estimates of $120 for
mid fire and $80 for low fire and saves screenshots without submitting the form.

This audit does not commit or reconcile the unrelated work in the original dirty
workspace. Production pricing was already deployed; this change preserves the
verification and deployment-tool fixes in source control.

Audit limitation: the isolated checkout's browser canary and index contract pass,
but the virtual staff regression reports differing `cloud.firestore` and
`cloud.firestore/default` releases. The original workspace contains a separate,
uncommitted correction that distinguishes `(default)` from the named `default`
database. That correction was not imported into this change. Do not describe the
whole promotion gate as passing from this branch until that independent checker
has been reconciled. Pricing-specific verification and all 12 helper tests pass.
