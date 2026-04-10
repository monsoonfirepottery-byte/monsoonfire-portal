"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testExports = void 0;
exports.createRoborockTransportFromEnv = createRoborockTransportFromEnv;
function normalizeBaseUrl(value) {
    return value.replace(/\/+$/, "");
}
function parseCsv(value) {
    return String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function boolFromEnv(value, fallback) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized)
        return fallback;
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
function numberFromEnv(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 250)
        return fallback;
    return parsed;
}
async function fetchJson(url, token, timeoutMs) {
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
    }
    finally {
        clearTimeout(timer);
    }
}
function mapHomeAssistantStatesToRoborockDevices(states, allowlist) {
    if (!Array.isArray(states))
        return [];
    const normalizedAllowlist = new Set(allowlist.map((entry) => entry.toLowerCase()));
    return states
        .filter((row) => row && typeof row === "object")
        .map((row) => row)
        .filter((row) => typeof row.entity_id === "string" && row.entity_id.startsWith("vacuum."))
        .filter((row) => {
        if (normalizedAllowlist.size === 0)
            return true;
        return normalizedAllowlist.has(String(row.entity_id).toLowerCase());
    })
        .map((row, index) => {
        const entityId = String(row.entity_id ?? `vacuum.unknown_${index + 1}`);
        const attrs = row.attributes && typeof row.attributes === "object" ? row.attributes : {};
        const rawBattery = attrs.battery_level;
        const battery = typeof rawBattery === "number" ? rawBattery : Number(rawBattery);
        const state = String(row.state ?? "unknown").toLowerCase();
        const online = !(state === "unavailable" || state === "unknown");
        const friendlyName = typeof attrs.friendly_name === "string" && attrs.friendly_name.trim()
            ? attrs.friendly_name.trim()
            : entityId;
        return {
            id: entityId,
            name: friendlyName,
            online,
            battery: Number.isFinite(battery) ? Math.max(0, Math.min(100, Math.round(battery))) : null,
            lastSeenAt: typeof row.last_changed === "string" ? row.last_changed : null,
            state,
            entityId,
        };
    });
}
function createRoborockTransportFromEnv(logger) {
    const provider = String(process.env.STUDIO_BRAIN_ROBOROCK_PROVIDER ?? "stub").trim().toLowerCase();
    if (provider !== "home_assistant") {
        logger.info("roborock_transport_stub_mode", {
            provider,
            note: "Set STUDIO_BRAIN_ROBOROCK_PROVIDER=home_assistant to enable live Roborock telemetry.",
        });
        return async (path) => {
            if (path === "/health")
                return { ok: true, provider: "stub" };
            return { devices: [] };
        };
    }
    const baseUrl = normalizeBaseUrl(String(process.env.STUDIO_BRAIN_ROBOROCK_BASE_URL ?? ""));
    const accessToken = String(process.env.STUDIO_BRAIN_ROBOROCK_ACCESS_TOKEN ?? "").trim();
    const verifyTls = boolFromEnv(process.env.STUDIO_BRAIN_ROBOROCK_VERIFY_TLS, true);
    const entityAllowlist = parseCsv(process.env.STUDIO_BRAIN_ROBOROCK_ENTITY_IDS);
    const defaultTimeoutMs = numberFromEnv(process.env.STUDIO_BRAIN_ROBOROCK_TIMEOUT_MS, 10_000);
    if (!baseUrl || !accessToken) {
        logger.warn("roborock_transport_missing_config", {
            provider,
            hasBaseUrl: Boolean(baseUrl),
            hasAccessToken: Boolean(accessToken),
            fallback: "stub",
        });
        return async (path) => {
            if (path === "/health")
                return { ok: false, provider: "stub_missing_config" };
            return { devices: [] };
        };
    }
    if (!verifyTls && baseUrl.startsWith("https://")) {
        logger.warn("roborock_transport_insecure_tls_override", {
            message: "STUDIO_BRAIN_ROBOROCK_VERIFY_TLS=false is set; prefer trusted certificates.",
        });
    }
    return async (path, _input, timeoutMs) => {
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
        throw new Error(`Unsupported roborock transport path: ${path}`);
    };
}
exports.__testExports = {
    mapHomeAssistantStatesToRoborockDevices,
};
