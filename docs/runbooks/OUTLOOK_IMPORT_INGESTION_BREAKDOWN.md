# Outlook Mail Import Breakdown (2026-03-03 to 2026-03-04)

This document captures the full failure chain from the last ingestion attempt and the remediation strategy so we do not repeat it.

## Executive summary
We hit repeated ingestion/auth failures due to three coupled issues:
- Environment/command-path drift between SSH and local terminals.
- A brittle OAuth wrapper path that implied a client secret existed.
- Repeated confusion between Azure app IDs/permission IDs and true app secrets.

No secrets were entered in this runbook; this document contains only process notes.

## Timeline and failures observed
1. Large `.pst` files were attempted via `scp` from Windows to Linux and repeatedly dropped.
2. Import attempts shifted to online mailbox import with `open-memory` scripts.
3. Multiple "script not found / missing npm script" errors happened after repo sync and command drift.
4. OAuth browser/device attempts were retried many times with:
   - missing tenant/client values in some invocations,
   - repeated typo/copy/paste friction across terminal windows,
   - repeated use of `e1fe6dd8-...` as if it were a client secret.
5. `AADSTS7000218 invalid_client` and `AADSTS50059 No tenant-identifying information` were returned.
6. Even after successful auth text, token exchange/import still did not proceed cleanly.

## Root causes
1. **False assumption about required credentials**
   - Wrapper and prompts implied user-supplied app secrets were known.
   - Actual requirement depends on app registration type (public vs confidential).
2. **Secret-type confusion**
   - A UUID permission object ID was mistaken for secret input.
   - Script error messages did not explicitly state that this is the wrong artifact format.
3. **Cross-terminal sync failures**
- user copied from SSH to Windows and back, with quoting/space and newline issues in command history.
4. **UX friction in wrapper flow**
   - Hard requirement for `MAIL_IMPORT_OUTLOOK_CLIENT_SECRET` in earlier wrapper behavior made public-client attempts impossible without manual secret entry.

## What changed to fix this
- `scripts/outlook-device-auth-ssh.mjs`
  - Removed hard stop that always required a local client secret.
  - Added non-blocking message indicating no secret and fallback behavior.
- `scripts/outlook-device-auth.mjs`
  - Added explicit invalid-client guidance:
    - identifies `invalid_client` failure mode,
    - explains likely causes for confidential clients,
    - explicitly states a UUID-like permission ID is not a client secret,
    - points to Azure Portal Certificates & secrets path.
  - Made token exchange failure reporting more actionable.
- `docs/runbooks/OPEN_MEMORY_SYSTEM.md`
  - Added guidance that `e1fe6dd8...` is a permission ID, not a secret.
  - Added direct SSH-only device flow command line path and fallback orientation.

## Preventive controls to avoid recurrence
1. **Treat secret availability as unknown by default**
   - Never branch on “secret exists” as implied precondition.
   - Public-client attempts must remain valid without secrets.
2. **Fail fast with explicit artifact guidance**
   - If an `invalid_client` occurs, show:
     - whether secret was supplied,
     - whether the entered value is UUID-like,
     - exact next steps to create/configure a valid client secret (if needed).
3. **One-command SSH flow only**
   - Continue to maintain commands that do not require local interactive copy/paste for common cases.
4. **Strictly separate IDs and secrets in docs**
   - In runbooks, label required values by type:
     - client ID,
     - tenant ID,
     - permission IDs,
     - client secret values.
5. **Default fallback documented in runbook**
   - If Outlook OAuth remains blocked, IMAP fallback remains supported and is documented as the alternate path.

## User trust actions to apply now
- Use IMAP fallback command for continued work if auth friction remains.
- Use the OAuth command again only with clear secret-source ownership and the corrected value type.
- Keep all future OAuth attempts in one terminal mode to reduce cross-shell paste damage.
