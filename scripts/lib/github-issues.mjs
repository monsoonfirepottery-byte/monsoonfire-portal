import { spawnSync } from "node:child_process";

function shortError(text) {
  return String(text || "").trim() || "gh command failed";
}

export function runCommand(command, args, { cwd, env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
  });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return {
    ok: code === 0,
    code,
    stdout,
    stderr,
  };
}

export function runGh(args, options = {}) {
  return runCommand("gh", args, options);
}

export function runGhJson(args, { allowFailure = true, ...options } = {}) {
  const response = runGh(args, { allowFailure, ...options });
  if (!response.ok) {
    return {
      ok: false,
      data: null,
      error: shortError(response.stderr || response.stdout),
    };
  }

  try {
    return {
      ok: true,
      data: response.stdout.trim() ? JSON.parse(response.stdout) : null,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseRepoSlug({ cwd } = {}) {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runCommand("git", ["config", "--get", "remote.origin.url"], { cwd, allowFailure: true });
  if (!remote.ok) return "";

  const value = remote.stdout.trim();
  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];
  return "";
}

export function parseIssueNumberFromUrl(url) {
  const match = String(url || "").match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function normalizeMarker(marker) {
  return String(marker || "")
    .replace(/^<!--\s*/, "")
    .replace(/\s*-->$/, "")
    .trim();
}

export function markerComment(marker) {
  const normalized = normalizeMarker(marker);
  return normalized ? `<!-- ${normalized} -->` : "";
}

export function bodyHasMarker(body, marker) {
  const comment = markerComment(marker);
  return comment ? String(body || "").includes(comment) : false;
}

export function appendMarker(body, marker) {
  const content = String(body || "").trim();
  const comment = markerComment(marker);
  if (!comment) return content;
  if (content.includes(comment)) return content;
  if (!content) return `${comment}\n`;
  return `${content}\n\n${comment}\n`;
}

function normalizeIssue(issue) {
  return {
    number: Number(issue?.number || 0),
    title: String(issue?.title || ""),
    url: String(issue?.html_url || issue?.url || ""),
    body: String(issue?.body || ""),
    state: String(issue?.state || ""),
    createdAt: String(issue?.created_at || issue?.createdAt || ""),
    updatedAt: String(issue?.updated_at || issue?.updatedAt || ""),
    closedAt: String(issue?.closed_at || issue?.closedAt || ""),
    labels: Array.isArray(issue?.labels) ? issue.labels.map((label) => String(label?.name || label || "")).filter(Boolean) : [],
  };
}

export function sortIssuesNewest(issues) {
  return [...(Array.isArray(issues) ? issues : [])].sort((left, right) => {
    const leftTime = Date.parse(String(left?.updatedAt || left?.createdAt || 0)) || 0;
    const rightTime = Date.parse(String(right?.updatedAt || right?.createdAt || 0)) || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return Number(right?.number || 0) - Number(left?.number || 0);
  });
}

export function findIssuesByExactTitle(issues, title) {
  const normalizedTitle = String(title || "");
  return sortIssuesNewest(issues).filter((issue) => issue.title === normalizedTitle);
}

export function findIssueByMarker(issues, marker) {
  return sortIssuesNewest(issues).find((issue) => bodyHasMarker(issue.body, marker)) || null;
}

export function pickCanonicalIssue(issues, { marker = "", title = "", preferredNumber = 0 } = {}) {
  const sorted = sortIssuesNewest(issues);
  if (preferredNumber > 0) {
    const preferred = sorted.find((issue) => issue.number === preferredNumber) || null;
    if (preferred) {
      const duplicates = sorted.filter(
        (issue) =>
          issue.number !== preferred.number && (issue.title === title || (marker && bodyHasMarker(issue.body, marker)))
      );
      return { issue: preferred, duplicates };
    }
  }

  const byMarker = marker ? sorted.filter((issue) => bodyHasMarker(issue.body, marker)) : [];
  if (byMarker.length > 0) {
    const [issue, ...duplicates] = byMarker;
    const extraDuplicates = sorted.filter(
      (candidate) =>
        candidate.number !== issue.number &&
        !duplicates.some((duplicate) => duplicate.number === candidate.number) &&
        title &&
        candidate.title === title
    );
    return { issue, duplicates: [...duplicates, ...extraDuplicates] };
  }

  const byTitle = title ? findIssuesByExactTitle(sorted, title) : [];
  if (byTitle.length > 0) {
    const [issue, ...duplicates] = byTitle;
    return { issue, duplicates };
  }

  return { issue: null, duplicates: [] };
}

export function ensureGhLabel(repoSlug, name, color, description, { cwd } = {}) {
  return runGh(
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { cwd, allowFailure: true }
  );
}

export function ensureGhLabels(repoSlug, labels, options = {}) {
  for (const label of labels || []) {
    if (!label?.name) continue;
    ensureGhLabel(repoSlug, label.name, label.color || "ededed", label.description || "", options);
  }
}

export function listRepoIssues(
  repoSlug,
  { state = "open", labels = "", maxPages = 3, perPage = 100, cwd } = {}
) {
  const collected = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({
      state,
      per_page: String(perPage),
      page: String(page),
    });
    if (labels) query.set("labels", labels);

    const response = runGhJson(["api", `repos/${repoSlug}/issues?${query.toString()}`], {
      allowFailure: true,
      cwd,
    });
    if (!response.ok) {
      return {
        ok: false,
        data: [],
        error: response.error,
      };
    }

    const pageItems = Array.isArray(response.data) ? response.data : [];
    const issues = pageItems.filter((item) => !item?.pull_request).map(normalizeIssue);
    collected.push(...issues);
    if (pageItems.length < perPage) break;
  }

  return {
    ok: true,
    data: sortIssuesNewest(
      Array.from(new Map(collected.map((issue) => [issue.number, issue])).values())
    ),
    error: "",
  };
}

export function createIssue(repoSlug, { title, body, labels = [] }, { cwd } = {}) {
  const args = ["issue", "create", "--repo", repoSlug, "--title", title, "--body", body];
  for (const label of labels) {
    args.push("--label", label);
  }
  const response = runGh(args, { cwd, allowFailure: true });
  if (!response.ok) {
    return {
      ok: false,
      issue: null,
      error: shortError(response.stderr || response.stdout),
    };
  }

  const url = response.stdout
    .split(/\s+/)
    .map((token) => token.trim())
    .find((token) => token.startsWith("https://github.com/"));

  return {
    ok: true,
    issue: {
      number: parseIssueNumberFromUrl(url),
      title,
      url: url || "",
      body,
      labels: [...labels],
      state: "open",
      createdAt: "",
      updatedAt: "",
      closedAt: "",
    },
    error: "",
  };
}

export function editIssue(repoSlug, issueNumber, { title, body, addLabels = [] }, { cwd } = {}) {
  const args = ["issue", "edit", String(issueNumber), "--repo", repoSlug];
  if (title !== undefined) args.push("--title", title);
  if (body !== undefined) args.push("--body", body);
  for (const label of addLabels) {
    args.push("--add-label", label);
  }
  return runGh(args, { cwd, allowFailure: true });
}

export function commentIssue(repoSlug, issueNumber, body, { cwd } = {}) {
  return runGh(["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", body], {
    cwd,
    allowFailure: true,
  });
}

export function closeIssue(
  repoSlug,
  issueNumber,
  { commentBody = "", stateReason = "not_planned" } = {},
  { cwd } = {}
) {
  if (commentBody) {
    const commented = commentIssue(repoSlug, issueNumber, commentBody, { cwd });
    if (!commented.ok) return commented;
  }
  return runGh(
    [
      "api",
      "--method",
      "PATCH",
      `repos/${repoSlug}/issues/${issueNumber}`,
      "-f",
      "state=closed",
      "-f",
      `state_reason=${stateReason}`,
    ],
    { cwd, allowFailure: true }
  );
}

export function fetchLatestIssueCommentBody(repoSlug, issueNumber, { cwd } = {}) {
  const response = runGhJson(
    ["issue", "view", String(issueNumber), "--repo", repoSlug, "--json", "comments"],
    { allowFailure: true, cwd }
  );
  if (!response.ok || !response.data || typeof response.data !== "object") return "";
  const comments = Array.isArray(response.data.comments) ? response.data.comments : [];
  const latest = comments.length > 0 ? comments[comments.length - 1] : null;
  return String(latest?.body || "");
}

export function ensureIssueWithMarker(
  repoSlug,
  { title, body, labels = [], marker = "", openIssues = [], preferredNumber = 0, createIfMissing = true },
  { cwd } = {}
) {
  const normalizedBody = appendMarker(body, marker);
  const issuePool = Array.isArray(openIssues) ? openIssues : [];
  const { issue, duplicates } = pickCanonicalIssue(issuePool, { marker, title, preferredNumber });

  if (!issue) {
    if (!createIfMissing) {
      return {
        ok: false,
        issue: null,
        created: false,
        updated: false,
        duplicates: [],
        error: "issue-not-found",
      };
    }

    const created = createIssue(repoSlug, { title, body: normalizedBody, labels }, { cwd });
    return {
      ok: created.ok,
      issue: created.issue,
      created: created.ok,
      updated: false,
      duplicates: [],
      error: created.error,
    };
  }

  const missingLabels = labels.filter((label) => !issue.labels.includes(label));
  const needsUpdate = issue.title !== title || issue.body !== normalizedBody || missingLabels.length > 0;
  if (!needsUpdate) {
    return {
      ok: true,
      issue,
      created: false,
      updated: false,
      duplicates,
      error: "",
    };
  }

  const edited = editIssue(
    repoSlug,
    issue.number,
    {
      title,
      body: normalizedBody,
      addLabels: missingLabels,
    },
    { cwd }
  );

  return {
    ok: edited.ok,
    issue: {
      ...issue,
      title,
      body: normalizedBody,
      labels: Array.from(new Set([...issue.labels, ...missingLabels])),
    },
    created: false,
    updated: edited.ok,
    duplicates,
    error: edited.ok ? "" : shortError(edited.stderr || edited.stdout),
  };
}
