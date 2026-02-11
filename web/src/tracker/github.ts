import type { FunctionsClient } from "../api/functionsClient";
import type { GitHubSyncTrace } from "./types";

export type GitHubLookupInput = {
  owner: string;
  repo: string;
  number: number;
  type: "issue" | "pr";
};

export type GitHubLookupResult = {
  url: string;
  title: string;
  state: string;
  updatedAt: string;
  merged?: boolean;
};

type GitHubLookupResponse = {
  ok: true;
  data: GitHubLookupResult;
};

export function parseGitHubReference(args: {
  rawUrlOrPath: string;
  ownerRepo: string;
  numberInput: string;
}): { owner: string; repo: string; number: number } {
  const trimmedUrl = args.rawUrlOrPath.trim();
  if (trimmedUrl) {
    const match = trimmedUrl.match(/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/i);
    if (!match) {
      throw new Error("Invalid GitHub URL. Expected /owner/repo/issues/123 or /pull/123.");
    }
    const owner = match[1] ?? "";
    const repo = match[2] ?? "";
    const number = Number(match[4] ?? "0");
    if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
      throw new Error("Could not parse owner/repo/number from GitHub URL.");
    }
    return { owner, repo, number };
  }

  const [owner, repo] = args.ownerRepo
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!owner || !repo) {
    throw new Error("Owner/repo is required when URL is not provided.");
  }

  const number = Number(args.numberInput.trim());
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Issue/PR number must be a positive number.");
  }

  return { owner, repo, number };
}

export function buildGitHubLookupCurl(baseUrl: string, input: GitHubLookupInput): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const payload = JSON.stringify(input);
  return [
    `curl -X POST '${normalizedBase}/githubLookup'`,
    "-H 'Content-Type: application/json'",
    "-H 'Authorization: Bearer <ID_TOKEN>'",
    `-d '${payload.replace(/'/g, "'\\''")}'`,
  ].join(" ");
}

export async function lookupGitHubMetadata(
  client: FunctionsClient,
  input: GitHubLookupInput
): Promise<{ result: GitHubLookupResult; trace: GitHubSyncTrace }> {
  const request = { ...input };
  const atIso = new Date().toISOString();
  try {
    const response = await client.postJson<GitHubLookupResponse>("githubLookup", request);
    const lastReq = client.getLastRequest();
    const status = typeof lastReq?.status === "number" ? lastReq.status : null;
    return {
      result: response.data,
      trace: {
        atIso,
        request,
        status,
        response,
      },
    };
  } catch (error: unknown) {
    const lastReq = client.getLastRequest();
    const status = typeof lastReq?.status === "number" ? lastReq.status : null;
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: {
        url: "",
        title: "",
        state: "",
        updatedAt: "",
      },
      trace: {
        atIso,
        request,
        status,
        response: { ok: false, message },
      },
    };
  }
}
