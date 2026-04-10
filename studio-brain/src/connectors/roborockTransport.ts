import type { Logger } from "../config/logger";

type Transport = (path: string, input: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

type HomeAssistantState = {
  entity_id?: unknown;
  state?: unknown;
  last_changed?: unknown;
  attributes?: Record<string, unknown>;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseCsv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 250) return fallback;
  return parsed;
}

async function fetchJson(url: string, token: string, timeoutMs: number): Promise<unknown> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Home Assistant request failed (${response.status}): ${body.slice(0, 240)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url: string, token: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Home Assistant request failed (${response.status}): ${responseBody.slice(0, 240)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapHomeAssistantStatesToRoborockDevices(states: unknown, allowlist: string[]): Array<Record<string, unknown>> {
  if (!Array.isArray(states)) return [];

  const normalizedAllowlist = new Set(allowlist.map((entry) => entry.toLowerCase()));

  return states
    .filter((row) => row && typeof row === "object")
    .map((row) => row as HomeAssistantState)
    .filter((row) => typeof row.entity_id === "string" && row.entity_id.startsWith("vacuum."))
    .filter((row) => {
      if (normalizedAllowlist.size === 0) return true;
      return normalizedAllowlist.has(String(row.entity_id).toLowerCase());
    })
    .map((row, index) => {
      const entityId = String(row.entity_id ?? `vacuum.unknown_${index + 1}`);
      const attrs = row.attributes && typeof row.attributes === "object" ? row.attributes : {};
      const state = String(row.state ?? "unknown").toLowerCase();
      const online = !(state === "unavailable" || state === "unknown");

      const numericOrNull = (value: unknown): number | null => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
        return null;
      };

      const friendlyName = typeof attrs.friendly_name === "string" && attrs.friendly_name.trim()
        ? attrs.friendly_name.trim()
        : entityId;

      return {
        id: entityId,
        name: friendlyName,
        online,
        battery: numericOrNull(attrs.battery_level),
        lastSeenAt: typeof row.last_changed === "string" ? row.last_changed : null,
        state,
        entityId,
        filterLifePct: numericOrNull(attrs.filter_life_remaining ?? attrs.filter_left),
        mainBrushLifePct: numericOrNull(attrs.main_brush_life_remaining ?? attrs.main_brush_left),
        sideBrushLifePct: numericOrNull(attrs.side_brush_life_remaining ?? attrs.side_brush_left),
        sensorDirtyLifePct: numericOrNull(attrs.sensor_dirty_life_remaining ?? attrs.sensor_dirty_left),
        cleanDurationSec: numericOrNull(attrs.clean_duration ?? attrs.last_clean_duration),
        cleanAreaSqM: numericOrNull(attrs.clean_area ?? attrs.last_clean_area),
        error: typeof attrs.error === "string" ? attrs.error : null,
        statusText: typeof attrs.status === "string" ? attrs.status : null,
      };
    });
}

export function createRoborockTransportFromEnv(logger: Logger): Transport {
  const provider = String(process.env.STUDIO_BRAIN_ROBOROCK_PROVIDER ?? "stub").trim().toLowerCase();
  if (provider !== "home_assistant") {
    logger.info("roborock_transport_stub_mode", {
      provider,
      note: "Set STUDIO_BRAIN_ROBOROCK_PROVIDER=home_assistant to enable live Roborock telemetry.",
    });
    return async (path) => {
      if (path === "/health") return { ok: true, provider: "stub" };
      return { devices: [] };
    };
  }

  const baseUrl = normalizeBaseUrl(String(process.env.STUDIO_BRAIN_ROBOROCK_BASE_URL ?? ""));
  const accessToken = String(process.env.STUDIO_BRAIN_ROBOROCK_ACCESS_TOKEN ?? "").trim();
  const verifyTls = boolFromEnv(process.env.STUDIO_BRAIN_ROBOROCK_VERIFY_TLS, true);
  const entityAllowlist = parseCsv(process.env.STUDIO_BRAIN_ROBOROCK_ENTITY_IDS);
  const defaultTimeoutMs = numberFromEnv(process.env.STUDIO_BRAIN_ROBOROCK_TIMEOUT_MS, 10_000);

  const defaultEntityId = String(process.env.STUDIO_BRAIN_ROBOROCK_HA_ENTITY_ID ?? entityAllowlist[0] ?? "").trim();
  const fullCleanDomain = String(process.env.STUDIO_BRAIN_ROBOROCK_HA_SERVICE_DOMAIN_FULL ?? "vacuum").trim() || "vacuum";
  const fullCleanService = String(process.env.STUDIO_BRAIN_ROBOROCK_HA_SERVICE_START_FULL ?? "start").trim() || "start";
  const roomCleanDomain = String(process.env.STUDIO_BRAIN_ROBOROCK_HA_SERVICE_DOMAIN_ROOM ?? "roborock").trim() || "roborock";
  const roomCleanService = String(process.env.STUDIO_BRAIN_ROBOROCK_HA_SERVICE_START_ROOM ?? "vacuum_clean_segment").trim() || "vacuum_clean_segment";
  const roomParamName = String(process.env.STUDIO_BRAIN_ROBOROCK_HA_ROOM_IDS_PARAM ?? "segments").trim() || "segments";

  if (!baseUrl || !accessToken) {
    logger.warn("roborock_transport_missing_config", {
      provider,
      hasBaseUrl: Boolean(baseUrl),
      hasAccessToken: Boolean(accessToken),
      fallback: "stub",
    });
    return async (path) => {
      if (path === "/health") return { ok: false, provider: "stub_missing_config" };
      return { devices: [] };
    };
  }

  if (!verifyTls && baseUrl.startsWith("https://")) {
    logger.warn("roborock_transport_insecure_tls_override", {
      message: "STUDIO_BRAIN_ROBOROCK_VERIFY_TLS=false is set; prefer trusted certificates.",
    });
  }

  return async (path, input, timeoutMs) => {
    const effectiveTimeoutMs = timeoutMs > 0 ? timeoutMs : defaultTimeoutMs;
    if (path === "/health") {
      const payload = await fetchJson(`${baseUrl}/api/`, accessToken, effectiveTimeoutMs);
      return payload;
    }

    if (path === "/devices") {
      const states = await fetchJson(`${baseUrl}/api/states`, accessToken, effectiveTimeoutMs);
      return {
        devices: mapHomeAssistantStatesToRoborockDevices(states, entityAllowlist),
      };
    }

    if (path === "/commands/start_full") {
      if (!defaultEntityId) {
        throw new Error("Missing STUDIO_BRAIN_ROBOROCK_HA_ENTITY_ID for clean.start_full command.");
      }
      return postJson(
        `${baseUrl}/api/services/${encodeURIComponent(fullCleanDomain)}/${encodeURIComponent(fullCleanService)}`,
        accessToken,
        { entity_id: defaultEntityId },
        effectiveTimeoutMs
      );
    }

    if (path === "/commands/start_rooms") {
      if (!defaultEntityId) {
        throw new Error("Missing STUDIO_BRAIN_ROBOROCK_HA_ENTITY_ID for clean.start_rooms command.");
      }
      const roomIds = Array.isArray(input.roomIds) ? input.roomIds : [];
      if (roomIds.length === 0) {
        throw new Error("roomIds[] is required for /commands/start_rooms.");
      }
      return postJson(
        `${baseUrl}/api/services/${encodeURIComponent(roomCleanDomain)}/${encodeURIComponent(roomCleanService)}`,
        accessToken,
        {
          entity_id: defaultEntityId,
          [roomParamName]: roomIds,
        },
        effectiveTimeoutMs
      );
    }

    throw new Error(`Unsupported roborock transport path: ${path}`);
  };
}

export const __testExports = {
  mapHomeAssistantStatesToRoborockDevices,
};
