const HANDLER_LOG_KEY = "mf_handler_error_log_v1";
const MAX_ENTRIES = 100;

type HandlerLogEntry = {
  atIso: string;
  label: string;
  message: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Unknown error";
  return String(error);
}

function readEntries(): HandlerLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HANDLER_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is HandlerLogEntry => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as { atIso?: unknown; label?: unknown; message?: unknown };
      return (
        typeof value.atIso === "string" &&
        typeof value.label === "string" &&
        typeof value.message === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeEntries(entries: HandlerLogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HANDLER_LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // ignore storage failures
  }
}

export function logHandlerError(error: unknown, label = "ui-handler"): void {
  const entry: HandlerLogEntry = {
    atIso: new Date().toISOString(),
    label,
    message: getErrorMessage(error),
  };

  console.error(`[${label}]`, error);
  const entries = readEntries();
  entries.push(entry);
  writeEntries(entries);
}

export function getHandlerErrorLog(): HandlerLogEntry[] {
  return readEntries();
}

export function clearHandlerErrorLog(): void {
  writeEntries([]);
}
