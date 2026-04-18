#!/usr/bin/env node

import http from "node:http";

const listenHost = String(process.env.STUDIO_BRAIN_CONTROL_TOWER_PROXY_HOST || "127.0.0.1").trim() || "127.0.0.1";
const listenPort = normalizePort(process.env.STUDIO_BRAIN_CONTROL_TOWER_PROXY_PORT, 18788);
const upstreamBase = trimRightSlash(String(process.env.STUDIO_BRAIN_CONTROL_TOWER_PROXY_UPSTREAM || "http://127.0.0.1:8787").trim() || "http://127.0.0.1:8787");
const adminToken = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN || "").trim();

const allowedHeaderNames = new Set(["authorization", "content-type", "accept", "x-request-id", "x-trace-id", "traceparent"]);

const server = http.createServer(async (req, res) => {
  const method = String(req.method || "GET").toUpperCase();
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");

  if (method === "OPTIONS") {
    res.writeHead(204, {
      Allow: "GET,POST,OPTIONS",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/healthz") {
    writeJson(res, 200, {
      ok: true,
      listenHost,
      listenPort,
      upstreamBase,
      adminTokenConfigured: Boolean(adminToken),
    });
    return;
  }

  if (!isAllowedPath(requestUrl.pathname)) {
    writeJson(res, 404, { ok: false, message: "path not allowed" });
    return;
  }

  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (!allowedHeaderNames.has(name.toLowerCase())) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (String(item || "").trim()) headers.append(name, String(item));
        }
        continue;
      }
      if (String(value || "").trim()) {
        headers.set(name, String(value));
      }
    }
    if (adminToken) {
      headers.set("x-studio-brain-admin-token", adminToken);
    }

    const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);
    const upstreamResponse = await fetch(`${upstreamBase}${requestUrl.pathname}${requestUrl.search}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(25_000),
    });

    const responseHeaders = {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    const contentType = upstreamResponse.headers.get("content-type");
    const requestId = upstreamResponse.headers.get("x-request-id");
    if (contentType) {
      responseHeaders["content-type"] = contentType;
    }
    if (requestId) {
      responseHeaders["x-request-id"] = requestId;
    }

    res.writeHead(upstreamResponse.status, responseHeaders);
    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    writeJson(res, 502, {
      ok: false,
      message: "studio brain bridge unavailable",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        listenHost,
        listenPort,
        upstreamBase,
        adminTokenConfigured: Boolean(adminToken),
      },
      null,
      2,
    ) + "\n",
  );
});

function isAllowedPath(pathname) {
  if (pathname === "/") return true;
  return (
    /^\/ops(?:\/.*)?$/i.test(pathname) ||
    /^\/api\/ops(?:\/.*)?$/i.test(pathname) ||
    /^\/api\/control-tower(?:\/.*)?$/i.test(pathname)
  );
}

function normalizePort(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function trimRightSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}
