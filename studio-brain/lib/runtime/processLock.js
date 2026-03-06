"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireProcessLock = acquireProcessLock;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_fs_2 = require("node:fs");
function isPidAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 1)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function parseLockPayload(lockPath) {
    try {
        const raw = (0, node_fs_1.readFileSync)(lockPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!Number.isFinite(Number(parsed?.pid ?? NaN)))
            return null;
        return {
            pid: Number(parsed.pid),
            startedAt: String(parsed.startedAt || ""),
            cwd: String(parsed.cwd || ""),
            cmd: String(parsed.cmd || ""),
        };
    }
    catch {
        return null;
    }
}
function releaseLockFile(path) {
    try {
        (0, node_fs_1.rmSync)(path, { force: true });
    }
    catch {
        // best-effort release
    }
}
function acquireProcessLock(options) {
    const lockPath = (0, node_path_1.resolve)(String(options.lockPath || ".studio-brain.runtime.lock"));
    (0, node_fs_2.mkdirSync)((0, node_path_1.dirname)(lockPath), { recursive: true });
    const payload = {
        pid: process.pid,
        startedAt: options.startedAt || new Date().toISOString(),
        cwd: options.cwd || process.cwd(),
        cmd: options.cmd || process.argv.join(" "),
    };
    const writeAttempt = () => {
        const fd = (0, node_fs_1.openSync)(lockPath, "wx");
        try {
            (0, node_fs_1.writeFileSync)(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        }
        finally {
            (0, node_fs_1.closeSync)(fd);
        }
    };
    try {
        writeAttempt();
    }
    catch (error) {
        const code = error?.code || "";
        if (code !== "EEXIST") {
            throw error;
        }
        const existing = parseLockPayload(lockPath);
        if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
            throw new Error(`studio-brain lock held by pid ${existing.pid} (cwd=${existing.cwd || "unknown"}, startedAt=${existing.startedAt || "unknown"}).`);
        }
        releaseLockFile(lockPath);
        writeAttempt();
    }
    let released = false;
    const release = () => {
        if (released)
            return;
        released = true;
        releaseLockFile(lockPath);
    };
    return {
        lockPath,
        payload,
        release,
    };
}
