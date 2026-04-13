import { resolveCodexThreadContext } from "../scripts/lib/codex-session-memory-utils.mjs";
import { stableHash } from "../scripts/lib/pst-memory-utils.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

export function resolveBootstrapThreadInfo({
  env = process.env,
  fallbackCwd = process.cwd(),
  fallbackQuery = "",
  stateDbPath,
} = {}) {
  const cwd = clean(env.CODEX_CWD || env.INIT_CWD || env.PWD || fallbackCwd) || fallbackCwd;
  const hintedThreadId = clean(env.CODEX_THREAD_ID);
  const resolved = resolveCodexThreadContext({
    threadId: hintedThreadId,
    cwd,
    stateDbPath,
  });

  if (resolved?.threadId && (!hintedThreadId || clean(resolved.threadId) === hintedThreadId)) {
    return {
      ...resolved,
      resolution: "state-db",
    };
  }

  return {
    threadId: hintedThreadId || `cwd-${stableHash(cwd, 16)}`,
    rolloutPath: "",
    cwd,
    title: "",
    firstUserMessage: clean(env.CODEX_FIRST_USER_MESSAGE || env.STUDIO_BRAIN_BOOTSTRAP_QUERY || fallbackQuery),
    updatedAtEpochSeconds: 0,
    updatedAt: "",
    resolution: "fallback",
  };
}
