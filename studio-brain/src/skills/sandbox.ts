import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../config/logger";

type RpcMessage = {
  id: string;
  method: "healthcheck" | "execute";
  params?: Record<string, unknown>;
};

type RpcResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type SkillSandboxClient = {
  executeSkill: (input: { skillPath: string; entrypoint?: string; payload?: Record<string, unknown>; command?: string }) => Promise<unknown>;
  healthcheck: () => Promise<boolean>;
  close: () => Promise<void>;
};

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 9)}`;
}

export async function createSkillSandbox(
  env: {
    enabled?: boolean;
    egressDeny?: boolean;
    egressAllowlist?: string[];
    entryTimeoutMs?: number;
    runtimeAllowlist?: string[];
    logger: Logger;
  }
): Promise<SkillSandboxClient | null> {
  if (env.enabled === false) return null;

  const root = process.cwd();
  const workerPath = path.join(root, "lib", "skills", "sandboxWorker.js");
  if (!fs.existsSync(workerPath)) {
    throw new Error(`sandbox worker missing at ${workerPath}. Run npm run build first.`);
  }

  const child = spawn(process.execPath, [workerPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS: String(env.entryTimeoutMs ?? 15_000),
      STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY: env.egressDeny ? "true" : "false",
      STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST: env.egressAllowlist?.join(",") ?? "",
      STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST: env.runtimeAllowlist?.join(",") ?? "",
    },
  });

  if (!child.stdout || !child.stdin) {
    throw new Error("sandbox process stdio unavailable");
  }

  const pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (reason: Error) => void }>();
  let closed = false;

  const onMessage = (line: string): void => {
    try {
      const parsed = JSON.parse(line) as RpcResponse;
      const pendingHandler = pending.get(parsed.id);
      if (!pendingHandler) return;
      pending.delete(parsed.id);
      if (parsed.ok) pendingHandler.resolve(parsed);
      else pendingHandler.reject(new Error(parsed.error ?? "sandbox error"));
    } catch {
      // ignore malformed frame
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const text = String(chunk);
    text.split("\n").forEach((line) => {
      if (line.trim().length > 0) onMessage(line.trim());
    });
  });

  const send = (message: RpcMessage): Promise<RpcResponse> => {
    return new Promise<RpcResponse>((resolve, reject) => {
      if (closed) {
        reject(new Error("sandbox closed"));
        return;
      }
      pending.set(message.id, { resolve, reject });
      child.stdin?.write(`${JSON.stringify(message)}\n`);
      setTimeout(() => {
        if (pending.delete(message.id)) {
          reject(new Error(`sandbox timeout for ${message.id}`));
        }
      }, env.entryTimeoutMs ? env.entryTimeoutMs + 1_000 : 16_000);
    });
  };

  const executeSkill = async (input: {
    skillPath: string;
    entrypoint?: string;
    payload?: Record<string, unknown>;
    command?: string;
  }): Promise<unknown> => {
    const payload: RpcMessage = { id: createRequestId(), method: "execute", params: input };
    const response = await send(payload);
    return response.result;
  };

  const healthcheck = async (): Promise<boolean> => {
    const response = await send({ id: createRequestId(), method: "healthcheck" });
    return response.ok && response.result !== undefined;
  };

  const close = async (): Promise<void> => {
    closed = true;
    for (const [, pendingResponse] of pending.entries()) {
      pendingResponse.reject(new Error("sandbox closed"));
    }
    pending.clear();
    await new Promise<void>((resolve) => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      child.once("exit", () => resolve());
    });
  };

  child.on("error", (error) => {
    env.logger.error("skill_sandbox_process_error", { message: error.message });
  });

  child.stderr.on("data", (chunk) => {
    env.logger.debug("skill_sandbox_stderr", { output: String(chunk) });
  });

  return { executeSkill, healthcheck, close };
}
