import { describe, expect, it, vi } from "vitest";

import {
  buildFiringSubmissionPayload,
  createClientRequestId,
  FiringSubmissionError,
  submitFiringTicket,
} from "./submission.js";

const receipt = {
  modelVersion: 3,
  intentId: "dropoff",
  workId: null,
  heatId: "mid",
  spaceId: "double",
  id: "MF-DROPOFF-MID",
  intent: "Drop off work",
  work: null,
  heat: "Mid fire",
  space: "Wide, tall, or two half shelves",
  routeName: "Mid fire",
  priceLabel: "Estimated price",
  price: "$50 estimated",
  inputs: ["Tallest and widest measurements"],
  nextAction: "Choose Print, Email, or Both.",
  staffBoundary: "We’ll confirm fit and loading at dropoff.",
};

const input = {
  clientRequestId: "fp_1234567890abcdef",
  name: "  Sam Potter  ",
  email: "  sam@example.com ",
  note: "  Tall handle  ",
  consentToContact: true,
  legalAcceptance: {
    termsAccepted: true,
    policiesAcknowledged: true,
    termsVersion: "2026-07-18",
    privacyNoticeVersion: "2026-07-18",
    studioPoliciesVersion: "2026-07-18",
  },
  website: "",
  deliveryMode: "both",
  receipt,
};

describe("firing ticket submission", () => {
  it("creates a bounded request id with the local issue date", () => {
    const requestId = createClientRequestId(new Date(2026, 6, 11));
    expect(requestId).toMatch(/^fp_20260711_[A-Za-z0-9_-]{16,55}$/);
    expect(requestId.length).toBeLessThanOrEqual(67);
  });

  it("sends the v3 canonical selection and delivery mode without rendered or recipient fields", () => {
    const payload = buildFiringSubmissionPayload(input);
    expect(payload).toMatchObject({
      name: "Sam Potter",
      email: "sam@example.com",
      note: "Tall handle",
      consentToContact: true,
      legalAcceptance: input.legalAcceptance,
      deliveryMode: "both",
      pagePath: "/firing-services/pathfinder/",
      selection: {
        modelVersion: 3,
        intentId: "dropoff",
        workId: null,
        heatId: "mid",
        spaceId: "double",
      },
    });
    expect(payload).not.toHaveProperty("artifact");
    expect(payload).not.toHaveProperty("to");
    expect(payload).not.toHaveProperty("html");
    expect(payload).not.toHaveProperty("ticketId");
  });

  it("allows Print to omit email and consent while preserving the same canonical selection", () => {
    expect(buildFiringSubmissionPayload({
      ...input,
      email: "",
      consentToContact: false,
      deliveryMode: "print",
    })).toMatchObject({
      email: "",
      consentToContact: false,
      deliveryMode: "print",
      selection: { modelVersion: 3, heatId: "mid", spaceId: "double" },
    });
  });

  it("returns the permanent ticket ID and queue state after success", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        ok: true,
        data: {
          ticketId: "MF-0711-BXUM",
          supportRequestId: "pathfinder-abc123",
          emailQueued: true,
          duplicate: false,
        },
      }),
    }));

    await expect(submitFiringTicket(input, { fetchImpl })).resolves.toMatchObject({
      ticketId: "MF-0711-BXUM",
      supportRequestId: "pathfinder-abc123",
      emailQueued: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      deliveryMode: "both",
      selection: { modelVersion: 3, spaceId: "double" },
    });
  });

  it("turns a server rejection into a recoverable typed error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => "30" },
      json: async () => ({ ok: false, code: "RATE_LIMITED", message: "Please wait." }),
    }));

    await expect(submitFiringTicket(input, { fetchImpl })).rejects.toMatchObject({
      name: "FiringSubmissionError",
      code: "RATE_LIMITED",
      status: 429,
      retryAfter: "30",
    });
    await expect(submitFiringTicket(input, { fetchImpl })).rejects.toBeInstanceOf(FiringSubmissionError);
  });
});
