import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

type ProcessLockPayload = {
  pid: number;
  startedAt: string;
  cwd: string;
  cmd: string;
};

type AcquireProcessLockOptions = {
  lockPath: string;
  cwd?: string;
  cmd?: string;
  startedAt?: string;
};

export type ProcessLockHandle = {
  lockPath: string;
  payload: ProcessLockPayload;
  release: () => void;
};

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLockPayload(lockPath: string): ProcessLockPayload | null {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as ProcessLockPayload;
    if (!Number.isFinite(Number(parsed?.pid ?? NaN))) return null;
    return {
      pid: Number(parsed.pid),
      startedAt: String(parsed.startedAt || ""),
      cwd: String(parsed.cwd || ""),
      cmd: String(parsed.cmd || ""),
    };
  } catch {
    return null;
  }
}

function releaseLockFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // best-effort release
  }
}

export function acquireProcessLock(options: AcquireProcessLockOptions): ProcessLockHandle {
  const lockPath = resolve(String(options.lockPath || ".studio-brain.runtime.lock"));
  mkdirSync(dirname(lockPath), { recursive: true });
  const payload: ProcessLockPayload = {
    pid: process.pid,
    startedAt: options.startedAt || new Date().toISOString(),
    cwd: options.cwd || process.cwd(),
    cmd: options.cmd || process.argv.join(" "),
  };

  const writeAttempt = () => {
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } finally {
      closeSync(fd);
    }
  };

  try {
    writeAttempt();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code || "";
    if (code !== "EEXIST") {
      throw error;
    }
    const existing = parseLockPayload(lockPath);
    if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
      throw new Error(
        `studio-brain lock held by pid ${existing.pid} (cwd=${existing.cwd || "unknown"}, startedAt=${
          existing.startedAt || "unknown"
        }).`
      );
    }
    releaseLockFile(lockPath);
    writeAttempt();
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseLockFile(lockPath);
  };

  return {
    lockPath,
    payload,
    release,
  };
}
