#!/usr/bin/env python3
"""Refresh the staff portal's public GitHub status snapshot on the hosting account."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen


REPO = "monsoonfirepottery-byte/monsoonfire-portal"
API = f"https://api.github.com/repos/{REPO}"
WORKFLOWS = (
    ("automationHealth", "Automation Health Daily", "portal-automation-health-daily.yml", "Health dashboard"),
    ("automationWeeklyDigest", "Automation Weekly Digest", "portal-automation-weekly-digest.yml", "Weekly digest"),
    ("canary", "Daily Authenticated Canary", "portal-daily-authenticated-canary.yml", "Authenticated portal checks"),
    ("indexGuard", "Firestore Index Guard", "firestore-index-contract-guard.yml", "Index guard"),
    ("promotionGate", "Post-Deploy Promotion Gate", "portal-post-deploy-promotion-gate.yml", "Release verification"),
    ("prodSmoke", "Production Smoke", "portal-prod-smoke.yml", "Production smoke checks"),
    ("prFunctional", "PR Functional Gate", "portal-pr-functional-gate.yml", "Pull request checks"),
)
ISSUES = (
    ("portalQa", "Portal QA Automation (Rolling)", 116, "Portal checks and follow-up"),
    ("portalInfra", "Portal Infra and Security Guards (Rolling)", 103, "Infrastructure and release guard updates"),
    ("governanceTuning", "Governance Weekly Tuning (Rolling)", 309, "Weekly governance summaries"),
    ("codexAutomation", "Codex Automation (Rolling)", 84, "Automation and backlog reporting"),
)


def get_json(path):
    request = Request(API + path, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "MonsoonFirePortalStatus",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def timestamp(value):
    if not value:
        return 0
    return int(datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)


def build_snapshot(read=get_json, now=None):
    workflows = []
    for key, label, file, hint in WORKFLOWS:
        runs = read(f"/actions/workflows/{file}/runs?branch=main&per_page=1")["workflow_runs"]
        run = runs[0] if runs else {}
        workflows.append(dict(
            key=key, label=label, workflowFile=file, outputHint=hint,
            runUrl=run.get("html_url") or "", status=run.get("status") or "unknown",
            conclusion=run.get("conclusion") or "", createdAtMs=timestamp(run.get("created_at")),
        ))
    issues = []
    for key, title, number, purpose in ISSUES:
        issue = read(f"/issues/{number}")
        # Link to the public issue rather than copying comments into the portal.
        issues.append(dict(
            key=key, title=title, issueNumber=number, purpose=purpose,
            issueUrl=issue["html_url"], state=issue["state"],
            updatedAtMs=timestamp(issue.get("updated_at")),
        ))
    return dict(
        version=1,
        generatedAtMs=int((now or datetime.now(timezone.utc)).timestamp() * 1000),
        workflows=workflows,
        issues=issues,
    )


def refresh(destination, read=get_json):
    # Finish all network reads before touching the last good snapshot.
    data = build_snapshot(read)
    path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=destination.parent, prefix=".automation-status-", delete=False
        ) as temporary:
            path = Path(temporary.name)
            json.dump(data, temporary, separators=(",", ":"))
            temporary.flush()
            os.fsync(temporary.fileno())
        path.chmod(0o644)
        path.replace(destination)
    finally:
        if path and path.exists():
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    refresh(args.output)


if __name__ == "__main__":
    main()
