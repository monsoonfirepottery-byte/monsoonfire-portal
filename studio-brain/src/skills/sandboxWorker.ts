import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";

type WorkerMessage = {
  id: string;
  method: "healthcheck" | "execute";
  params?: {
    skillPath?: string;
    entrypoint?: string;
    payload?: Record<string, unknown>;
    input?: Record<string, unknown>;
    command?: string;
  };
};

type WorkerResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

function parseHostFromInput(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.hostname;
  } catch {
    return undefined;
  }
}

function applyEgressPolicy(): void {
  const denyEgress = process.env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY === "true";
  if (!denyEgress) return;

  const allowlist = new Set(
    (process.env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

  const checkUrl = (value: string): void => {
    const host = parseHostFromInput(value);
    if (!host) return;
    if (allowlist.size > 0 && allowlist.has(host)) return;
    throw new Error(`egress blocked by policy for host ${host}`);
  };

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const target = typeof input === "string" || input instanceof URL ? String(input) : (input as { href: string }).href;
      checkUrl(target);
      return originalFetch.call(globalThis as never, input, init);
    };
  }

  const blockClient = (client: typeof import("http")): void => {
    const originalRequest = client.request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.request = (...args: any[]) => {
      const first = args[0];
      if (typeof first === "string") {
        checkUrl(first);
      } else if (first && typeof first === "object") {
        const options = first as { hostname?: string; host?: string };
        const host = options.hostname ?? options.host;
        if (host) {
          checkUrl(`https://${host}`);
        }
      }
      return originalRequest.apply(client, args);
    };
  };
  blockClient(require("http"));
  blockClient(require("https"));
}

function send(response: WorkerResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function readCommaList(raw: string | undefined): Set<string> {
  if (!raw) return new Set<string>();
  return new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("skill execution timed out")), timeoutMs);
    void promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function executeSkill(input: WorkerMessage["params"]): Promise<unknown> {
  if (!input || !input.skillPath) {
    throw new Error("skillPath is required");
  }
  const entrypoint = input.entrypoint || "index.js";
  const source = path.resolve(process.cwd(), input.skillPath, entrypoint);
  if (!fs.existsSync(source)) {
    throw new Error(`skill entrypoint missing: ${source}`);
  }

  const loader = createRequire(__filename);
  const loaded = loader(source) as {
    execute?: (payload: unknown, context: Record<string, unknown>) => Promise<unknown> | unknown;
    default?: (payload: unknown, context: Record<string, unknown>) => Promise<unknown> | unknown;
  };
  const execute = loaded.execute ?? loaded.default;
  if (typeof execute !== "function") {
    throw new Error("skill module missing execute function");
  }
  const command = String(input.command ?? "default");
  const allowlist = readCommaList(process.env.STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST);
  if (allowlist.size > 0 && !allowlist.has(command)) {
    throw new Error(`skill command "${command}" blocked by runtime allowlist`);
  }

  const payload = input.payload ?? input.input ?? {};
  return Promise.resolve(
    execute(payload, {
      command,
      context: {
        allowedEgressHosts: (process.env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      },
    } as never)
  );
}

async function main(): Promise<void> {
  applyEgressPolicy();

  const lineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const timeoutMs = Math.max(250, Number(process.env.STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS ?? "15000"));

  lineReader.on("line", async (raw) => {
    let parsed: WorkerMessage;
    try {
      parsed = JSON.parse(raw) as WorkerMessage;
    } catch {
      send({ id: "invalid", ok: false, error: "invalid rpc payload" });
      return;
    }

    if (parsed.method === "healthcheck") {
      send({ id: parsed.id, ok: true, result: { ok: true } });
      return;
    }

    if (parsed.method !== "execute") {
      send({ id: parsed.id, ok: false, error: `unknown method ${parsed.method}` });
      return;
    }

    try {
      const result = await withTimeout(executeSkill(parsed.params), timeoutMs);
      send({ id: parsed.id, ok: true, result });
    } catch (error) {
      send({ id: parsed.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

void main().catch((error) => {
  send({ id: "fatal", ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
