import test from "node:test";
import assert from "node:assert/strict";

import { applyCors } from "./shared";

type CapturedResponse = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: unknown;
};

function createMockResponse() {
  const captured: CapturedResponse = {
    statusCode: null,
    headers: {},
    body: undefined,
  };

  const response = {
    status: (statusCode: number) => {
      captured.statusCode = statusCode;
      return response;
    },
    set: (name: string, value: string) => {
      captured.headers[name] = value;
      return response;
    },
    json: (value: unknown) => {
      captured.body = value;
    },
    send: (value: string) => {
      captured.body = value;
    },
  };

  return {
    response,
    captured,
  };
}

test("applyCors sets permissive CORS headers for cross-origin POST requests", () => {
  const { response, captured } = createMockResponse();

  const handled = applyCors(
    {
      method: "POST",
      headers: {
        origin: "https://monsoonfire-portal.web.app",
      },
    } as never,
    response as never
  );

  assert.equal(handled, false);
  assert.equal(captured.headers["Access-Control-Allow-Origin"], "https://monsoonfire-portal.web.app");
  assert.equal(captured.headers["Access-Control-Allow-Methods"], "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  assert.equal(captured.headers["Access-Control-Allow-Headers"].includes("Content-Type"), true);
});

test("applyCors handles preflight OPTIONS requests and returns early", () => {
  const { response, captured } = createMockResponse();

  const handled = applyCors(
    {
      method: "OPTIONS",
      headers: {
        origin: "https://monsoonfire-portal.web.app",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, x-admin-token",
      },
    } as never,
    response as never
  );

  assert.equal(handled, true);
  assert.equal(captured.statusCode, 204);
});

test("applyCors allows requests without origin header and falls back to wildcard allow origin", () => {
  const { response, captured } = createMockResponse();

  const handled = applyCors(
    {
      method: "POST",
      headers: {},
    } as never,
    response as never
  );

  assert.equal(handled, false);
  assert.equal(captured.headers["Access-Control-Allow-Origin"], "*");
});
