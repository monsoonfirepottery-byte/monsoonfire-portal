# Security History Rewrite Playbook

## Purpose
Remove leaked or risky historical secrets/config from git history (including old clawbot-era artifacts), then safely republish rewritten history.

## Preconditions
1. Treat any discovered credentials as compromised and rotate them first.
2. Freeze merges to the target branch while rewrite is in progress.
3. Ensure maintainers understand this is a force-push event requiring re-clones.

## 1) Baseline scan and evidence
```bash
cd /home/wuff/monsoonfire-portal
npm run security:history:scan
npm run security:history:scan:broad   # optional broader (noisier) secret marker sweep
npm run security:gitleaks:strict
```

Artifacts:
- `output/security/history-secret-scan.json`
- `output/security/gitleaks-local-dir.json`

## 2) Create an isolated rewrite clone
```bash
cd /home/wuff
rm -rf monsoonfire-portal-rewrite

git clone --mirror /home/wuff/monsoonfire-portal monsoonfire-portal-rewrite
cd monsoonfire-portal-rewrite
```

## 3) Define replacement/redaction rules
Create a replacement file (example: `replace-text.txt`) with one entry per literal to scrub:

```text
regex:(?i)discord(_|)bot(_|)token\s*=\s*.+==>DISCORD_BOT_TOKEN=[REDACTED]
regex:https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+==>https://discord.com/api/webhooks/[REDACTED]
regex:(?i)claw(db)?bot(_|)token\s*[:=]\s*.+==>CLAWBOT_TOKEN=[REDACTED]
```

## 4) Rewrite history with git-filter-repo
If removing entire files/paths:
```bash
git filter-repo \
  --invert-paths \
  --path secrets/clawbot.env \
  --path secrets/discord-bot.env
```

If redacting content in-place:
```bash
git filter-repo --replace-text replace-text.txt
```

You can combine both styles in a single rewrite pass.

## 5) Verify rewritten mirror
```bash
npm --prefix /home/wuff/monsoonfire-portal run security:history:scan
# Or inside mirror repo, run equivalent git pattern checks directly:
git log --all --pickaxe-regex -G 'discord(app)?\.com/api/webhooks/' --pretty=oneline
```

Expected: no high-risk matches for rotated secrets and webhook URLs.

## 6) Publish rewritten refs
```bash
# Double-check remote before force push
git remote -v

# Force push all refs after verification
git push --force --mirror origin
```

## 7) Team recovery instructions
After force push, every collaborator should run:
```bash
# safest option
mv monsoonfire-portal monsoonfire-portal.pre-rewrite-backup

git clone <origin-url> monsoonfire-portal
```

Avoid mixing old and rewritten histories via normal pull/rebase.

## 8) Post-rewrite hardening
1. Keep `npm run security:history:scan` and `npm run security:gitleaks:strict` in CI gates.
2. Store runtime secrets only in ignored `secrets/` paths or secure secret manager.
3. Add bot ingest secrets to rotation schedule (`STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET`).

## Rollback note
A history rewrite rollback is itself another force-push event. Keep the pre-rewrite mirror as a short-lived safety backup until the team confirms clean re-clones.
