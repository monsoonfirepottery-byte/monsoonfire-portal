import test from "node:test";
import assert from "node:assert/strict";

import {
  assertFiringPathfinderIdempotencyMatch,
  buildCanonicalFiringPathfinderArtifact,
  buildFiringPathfinderSubmissionDocuments,
  FiringPathfinderIdempotencyConflictError,
  firingPathfinderArtifactSchema,
  firingPathfinderSubmissionSchema,
  formatFiringPathfinderArtistEmailHtml,
  formatFiringPathfinderArtistEmailText,
  formatFiringPathfinderEmailHtml,
  formatFiringPathfinderEmailText,
  handleFiringPathfinderRequest,
  makeFiringTicketId,
  makeFiringPathfinderPayloadHash,
  materializeFiringPathfinderSubmission,
  type FiringPathfinderSubmission,
  type FiringPathfinderSubmissionRequest,
  type FiringPathfinderSelection,
} from "./firingPathfinderRequest";
import { Timestamp, type RequestLike, type ResponseLike } from "./shared";
import { queueTicketDto, staffFinalizeFiringPickupSchema, validateChargeForTicket } from "./firingBilling";

const validRequest: FiringPathfinderSubmissionRequest = {
  clientRequestId: "fp_1234567890abcdef",
  name: "Sam Potter",
  email: "sam@example.com",
  note: "Tall handle & <careful> placement",
  consentToContact: true,
  legalAcceptance: {
    termsAccepted: true,
    policiesAcknowledged: true,
    termsVersion: "2026-07-18",
    privacyNoticeVersion: "2026-07-18",
    studioPoliciesVersion: "2026-07-18",
  },
  deliveryMode: "email",
  website: "",
  pagePath: "/firing-services/pathfinder/",
  selection: {
    modelVersion: 2,
    intentId: "unusual",
    workId: "large",
    heatId: "unknown",
  },
};
const validSubmission: FiringPathfinderSubmission = materializeFiringPathfinderSubmission(validRequest);

function makeResponse() {
  let statusCode = 200;
  let body: unknown = null;
  const headers: Record<string, string> = {};
  const response: ResponseLike = {
    status(value) {
      statusCode = value;
      return response;
    },
    json(value) {
      body = value;
    },
    set(name, value) {
      headers[name] = value;
    },
    send(value) {
      body = value;
    },
  };
  return {
    response,
    read: () => ({ statusCode, body, headers }),
  };
}

function makeRequest(body: unknown, method = "POST"): RequestLike {
  return {
    method,
    body,
    ip: "127.0.0.1",
    headers: { origin: "https://monsoonfire.com" },
  };
}

test("submission schema freezes v1/v2, accepts strict v3 space tuples, and validates delivery contact", () => {
  assert.equal(firingPathfinderSubmissionSchema.safeParse(validRequest).success, true);
  const { legalAcceptance: _missingAcceptance, ...requestWithoutAcceptance } = validRequest;
  void _missingAcceptance;
  assert.equal(firingPathfinderSubmissionSchema.safeParse(requestWithoutAcceptance).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    legalAcceptance: { ...validRequest.legalAcceptance, termsAccepted: false },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    legalAcceptance: { ...validRequest.legalAcceptance, termsVersion: "2026-07-17" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    clientRequestId: "fp_20260711_1234567890abcdef",
  }).success, true);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    artifact: validSubmission.artifact,
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    to: "attacker@example.com",
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 1, intentId: "pickup", workId: "large", heatId: "unknown" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 1, intentId: "new", workId: "unknown", heatId: "mid" },
  }).success, false);
  for (const heatId of ["mid", "custom", "unknown"] as const) {
    assert.equal(firingPathfinderSubmissionSchema.safeParse({
      ...validRequest,
      selection: { modelVersion: 1, intentId: "known", workId: "earthenware", heatId },
    }).success, false);
  }
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 2, intentId: "unusual", workId: "large", heatId: "unknown" },
  }).success, true);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 2, intentId: "dropoff", workId: "unknown", heatId: "mid" },
  }).success, true);
  for (const heatId of ["mid", "custom", "unknown"] as const) {
    assert.equal(firingPathfinderSubmissionSchema.safeParse({
      ...validRequest,
      selection: { modelVersion: 2, intentId: "dropoff", workId: "earthenware", heatId },
    }).success, false);
  }
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 2, intentId: "collection", workId: "large", heatId: "unknown" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: "stoneware", heatId: "mid" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "half" },
  }).success, true);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "unknown" },
  }).success, true);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "not-a-space" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: "stoneware", heatId: "mid", spaceId: "half" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 2, intentId: "dropoff", workId: "stoneware", heatId: "mid", spaceId: "half" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "collection", workId: null, heatId: null, spaceId: "half" },
  }).success, false);
  assert.equal(firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    deliveryMode: "print",
    email: "",
    consentToContact: false,
  }).success, true);
  for (const deliveryMode of ["email", "both"] as const) {
    assert.equal(firingPathfinderSubmissionSchema.safeParse({
      ...validRequest,
      deliveryMode,
      email: "",
    }).success, false);
    assert.equal(firingPathfinderSubmissionSchema.safeParse({
      ...validRequest,
      deliveryMode,
      consentToContact: false,
    }).success, false);
  }
  const missingEmail = firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    deliveryMode: "email",
    email: "",
  });
  assert.equal(missingEmail.success, false);
  if (!missingEmail.success) {
    assert.equal(
      missingEmail.error.issues.find((issue) => issue.path[0] === "email")?.message,
      "Email is required when sending this request to the studio",
    );
  }
  const missingConsent = firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    deliveryMode: "email",
    consentToContact: false,
  });
  assert.equal(missingConsent.success, false);
  if (!missingConsent.success) {
    assert.equal(
      missingConsent.error.issues.find((issue) => issue.path[0] === "consentToContact")?.message,
      "Permission to reply is required when emailing this request",
    );
  }
  const legacyDefault = firingPathfinderSubmissionSchema.safeParse({
    ...validRequest,
    deliveryMode: undefined,
  });
  assert.equal(legacyDefault.success, true);
  if (legacyDefault.success) assert.equal(legacyDefault.data.deliveryMode, "email");
});

test("server reconstructs canonical unusual, mid-fire, and readiness artifacts", () => {
  assert.deepEqual(validSubmission.artifact, {
    id: "MF-UNUSUAL-LARGE-UNKNOWN",
    intent: "I have something unusual",
    work: "Mixed, large, or unusual work",
    heat: "I’m not sure",
    routeName: "Fit check",
    priceLabel: "Price",
    price: "No estimate yet",
    inputs: [
      "Firing range, if known",
      "Tallest and widest measurements",
      "Notes about the surface, shape, or handling",
    ],
    nextAction: "Email these details to the studio and we’ll help you plan the firing safely.",
    staffBoundary: "We’ll confirm fit, studio access, loading, and timing before anything is scheduled.",
  });
  assert.deepEqual(buildCanonicalFiringPathfinderArtifact({
    modelVersion: 1,
    intentId: "known",
    workId: "stoneware",
    heatId: "mid",
  }), {
    id: "MF-KNOWN-STONEWARE-MID",
    intent: "I know the clay and firing range",
    work: "Stoneware mugs",
    heat: "Mid fire",
    routeName: "Mid fire",
    priceLabel: "Example price",
    price: "$35 half shelf — example",
    inputs: [
      "Clay and glaze labels or notes",
      "Glazed or bare surfaces",
      "Tallest and widest measurements",
      "Shape or special-handling notes",
    ],
    nextAction: "Email this ticket to the studio. We’ll confirm fit, loading, and timing with you.",
    staffBoundary: "We’ll confirm fit, studio access, loading, and timing before anything is scheduled.",
  });
  assert.deepEqual(buildCanonicalFiringPathfinderArtifact({
    modelVersion: 1,
    intentId: "pickup",
    workId: null,
    heatId: null,
  }), {
    id: "MF-PICKUP-STATUS-READY",
    intent: "Is my work ready?",
    work: "Unfired work readiness check",
    heat: "Not applicable",
    routeName: "Ready check",
    priceLabel: "Price",
    price: "No new estimate",
    inputs: [
      "Firing range, if known",
      "Tallest and widest measurements",
      "How you plan to pad and carry it",
      "Anything thin, attached, or fragile",
    ],
    nextAction: "Pack each piece so it cannot touch another piece or the sides of the container. If it can travel safely, bring it in; the studio will hold it until it is ready for the kiln.",
    staffBoundary: "We’ll confirm fit, studio access, loading, and timing before anything is scheduled.",
  });
  assert.deepEqual(buildCanonicalFiringPathfinderArtifact({
    modelVersion: 2,
    intentId: "collection",
    workId: null,
    heatId: null,
  }), {
    id: "MF-COLLECTION-STATUS-READY",
    intent: "Pick up finished work",
    work: "Finished work pickup",
    heat: "Not applicable",
    routeName: "Pickup",
    priceLabel: "Price",
    price: "No new estimate",
    inputs: ["Name or nickname used at dropoff", "Ticket reference, if handy", "Anything that helps identify the work"],
    nextAction: "Use the private address, access, and pickup timing from the ready note. Standard pickup is self-serve; pad the work for the trip home.",
    staffBoundary: "If the ready note is missing, reply to this email and the studio will resend the private access details.",
  });
  assert.deepEqual(buildCanonicalFiringPathfinderArtifact({
    modelVersion: 3,
    intentId: "dropoff",
    workId: null,
    heatId: "mid",
    spaceId: "double",
  }), {
    id: "MF-DROPOFF-MID",
    intent: "Drop off work",
    work: null,
    heat: "Mid fire",
    space: "Two half shelves",
    estimateNote: "This is an estimate. You pay after the firing for the space your work used. If something goes wrong because of us, there’s no firing charge. If the issue comes from the clay, glaze, or construction, the firing is still charged.",
    routeName: "Mid fire",
    priceLabel: "Estimated price",
    price: "$70 estimated",
    inputs: [
      "Clay and glaze labels or notes",
      "Glazed or bare surfaces",
      "Tallest and widest measurements",
      "Shape or special-handling notes",
      "Tallest piece, especially anything over 10 inches",
    ],
    nextAction: "Choose whether to print this ticket, email it to the studio, or do both. We’ll confirm fit, loading, and timing with you.",
    staffBoundary: "We’ll confirm fit, studio access, loading, and timing before anything is scheduled.",
  });
});

test("all 32 frozen v1, 17 frozen v2, and 24 v3 tuples parse and produce valid artifacts", () => {
  const legacySelections: FiringPathfinderSelection[] = [
    { modelVersion: 1, intentId: "pickup", workId: null, heatId: null },
    { modelVersion: 1, intentId: "unusual", workId: "large", heatId: "unknown" },
  ];
  const standardIntents = ["new", "known", "dropoff"] as const;
  const flexibleWorks = ["stoneware", "large"] as const;
  const knownHeats = ["low", "mid", "custom", "unknown"] as const;
  for (const intentId of standardIntents) {
    legacySelections.push({ modelVersion: 1, intentId, workId: "unknown", heatId: "unknown" });
    legacySelections.push({ modelVersion: 1, intentId, workId: "earthenware", heatId: "low" });
    for (const workId of flexibleWorks) {
      for (const heatId of knownHeats) {
        legacySelections.push({ modelVersion: 1, intentId, workId, heatId });
      }
    }
  }

  const currentSelections: FiringPathfinderSelection[] = [
    { modelVersion: 2, intentId: "collection", workId: null, heatId: null },
    { modelVersion: 2, intentId: "readiness", workId: null, heatId: null },
    { modelVersion: 2, intentId: "unusual", workId: "large", heatId: "unknown" },
    { modelVersion: 2, intentId: "question", workId: "unknown", heatId: "unknown" },
    { modelVersion: 2, intentId: "dropoff", workId: "earthenware", heatId: "low" },
  ];
  for (const workId of ["stoneware", "large", "unknown"] as const) {
    for (const heatId of knownHeats) {
      currentSelections.push({ modelVersion: 2, intentId: "dropoff", workId, heatId });
    }
  }

  const rangeOnlySelections: FiringPathfinderSelection[] = [
    { modelVersion: 3, intentId: "collection", workId: null, heatId: null, spaceId: null },
    { modelVersion: 3, intentId: "readiness", workId: null, heatId: null, spaceId: null },
    { modelVersion: 3, intentId: "unusual", workId: "large", heatId: "unknown", spaceId: null },
    { modelVersion: 3, intentId: "question", workId: "unknown", heatId: "unknown", spaceId: null },
  ];
  for (const heatId of knownHeats) {
    for (const spaceId of ["half", "double", "triple", "large", "unknown"] as const) {
      rangeOnlySelections.push({ modelVersion: 3, intentId: "dropoff", workId: null, heatId, spaceId });
    }
  }

  assert.equal(legacySelections.length, 32);
  assert.equal(currentSelections.length, 17);
  assert.equal(rangeOnlySelections.length, 24);
  for (const [selections, expectedUniqueArtifactIds] of [
    [legacySelections, 32],
    [currentSelections, 17],
    [rangeOnlySelections, 8],
  ] as const) {
    const ids = new Set<string>();
    for (const selection of selections) {
      assert.equal(firingPathfinderSubmissionSchema.safeParse({ ...validRequest, selection }).success, true);
      const artifact = buildCanonicalFiringPathfinderArtifact(selection);
      assert.equal(firingPathfinderArtifactSchema.safeParse(artifact).success, true);
      assert.doesNotMatch(JSON.stringify(artifact), /photos?/i);
      assert.doesNotMatch(JSON.stringify(artifact), /final price/i);
      assert.doesNotMatch(JSON.stringify(artifact), /completely dry|dryness/i);
      ids.add(artifact.id);
    }
    assert.equal(ids.size, expectedUniqueArtifactIds);
  }
});

test("v3 pricing is earned from firing range and kiln-space estimate", () => {
  const expected = {
    low: {
      half: ["Estimated price", "$20 estimated"],
      double: ["Estimated price", "$40 estimated"],
      triple: ["Estimated price", "$60 estimated"],
      large: ["Maximum estimate", "Up to $80 — per-client base cap"],
      unknown: ["Price", "No estimate yet"],
    },
    mid: {
      half: ["Estimated price", "$35 estimated"],
      double: ["Estimated price", "$70 estimated"],
      triple: ["Estimated price", "$105 estimated"],
      large: ["Maximum estimate", "Up to $120 — per-client base cap"],
      unknown: ["Price", "No estimate yet"],
    },
    custom: {
      half: ["Price", "No estimate yet"],
      double: ["Price", "No estimate yet"],
      triple: ["Price", "No estimate yet"],
      large: ["Price", "No estimate yet"],
      unknown: ["Price", "No estimate yet"],
    },
    unknown: {
      half: ["Price", "No estimate yet"],
      double: ["Price", "No estimate yet"],
      triple: ["Price", "No estimate yet"],
      large: ["Price", "No estimate yet"],
      unknown: ["Price", "No estimate yet"],
    },
  } as const;
  const spaceLabels = {
    half: "One half shelf",
    double: "Two half shelves",
    triple: "Three half shelves",
    large: "Four or more half shelves / whole kiln",
    unknown: "Space needs studio check",
  } as const;

  for (const heatId of ["low", "mid", "custom", "unknown"] as const) {
    for (const spaceId of ["half", "double", "triple", "large", "unknown"] as const) {
      const artifact = buildCanonicalFiringPathfinderArtifact({
        modelVersion: 3,
        intentId: "dropoff",
        workId: null,
        heatId,
        spaceId,
      });
      assert.equal(artifact.work, null);
      assert.equal(artifact.space, spaceLabels[spaceId]);
      assert.equal(artifact.priceLabel, expected[heatId][spaceId][0]);
      assert.equal(artifact.price, expected[heatId][spaceId][1]);
      if (heatId === "unknown" || spaceId === "unknown") {
        assert.equal(artifact.routeName, "Fit check");
        assert.deepEqual(artifact.inputs, [
          "Firing range, if known",
          "Tallest and widest measurements",
          "Notes about the surface, shape, or handling",
        ]);
      }
    }
  }
});

test("new drop-off records preserve optional requests and quote version in ticket and email", () => {
  const submission = materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "large" },
    addOnRequests: { private: true, rush: true, communitySharing: false },
  });
  const docs = buildFiringPathfinderSubmissionDocuments(submission, "MF-TEST", "support-test", "mail-test", Timestamp.fromMillis(1000), "2026-10-29T12:00:00Z");
  assert.equal(docs.ticket.pricingVersion, 3);
  assert.deepEqual(docs.ticket.addOnRequests, { private: true, rush: true, communitySharing: false });
  assert.match(formatFiringPathfinderArtistEmailText(submission, "MF-TEST", "2026-10-29T12:00:00Z"), /Fire tonight request/);
  assert.notEqual(makeFiringPathfinderPayloadHash(submission), makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({ ...submission, addOnRequests: { private: true, rush: false, communitySharing: false } })));
  const staffTicket = queueTicketDto("MF-TEST", docs.ticket, true);
  assert.equal(staffTicket.pricingVersion, 3);
  assert.equal(staffTicket.addOnRequests.rush, true);
  const finalization = staffFinalizeFiringPickupSchema.parse({ ticketId: "MF-TEST", expectedVersion: 0, clientRequestId: "11111111-1111-4111-8111-111111111111", outcome: "normal_billable", actualSpace: { billingUnit: "whole_kiln", quantity: 1 }, rateKey: "mid_shared_v3", finalChargeCents: 14000, privateFulfilled: true, rushFulfilled: false, confirmedReady: true });
  assert.deepEqual(validateChargeForTicket(finalization, staffTicket.heatId, docs.ticket, { rateKey: "mid_shared_v3", chargeCents: 14000 }), { rateMatched: true, expectedChargeCents: 14000 });
});

test("idempotency accepts an exact replay and rejects reused keys with changed details", () => {
  const originalHash = makeFiringPathfinderPayloadHash(validSubmission);
  const replayHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({ ...validRequest }));
  const changedHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({
    ...validRequest,
    email: "other@example.com",
  }));
  const legacyHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 1, intentId: "unusual", workId: "large", heatId: "unknown" },
  }));
  const changedDeliveryHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({
    ...validRequest,
    deliveryMode: "both",
  }));
  const changedRequestIdHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({
    ...validRequest,
    clientRequestId: "fp_fedcba0987654321",
  }));
  const v3HalfHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "half" },
  }));
  const v3DoubleHash = makeFiringPathfinderPayloadHash(materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "double" },
  }));

  assert.equal(replayHash, originalHash);
  assert.notEqual(changedHash, originalHash);
  assert.notEqual(legacyHash, originalHash);
  assert.notEqual(changedDeliveryHash, originalHash);
  assert.notEqual(changedRequestIdHash, originalHash);
  assert.notEqual(v3HalfHash, v3DoubleHash);
  assert.doesNotThrow(() => assertFiringPathfinderIdempotencyMatch(originalHash, replayHash));
  assert.throws(
    () => assertFiringPathfinderIdempotencyMatch(originalHash, changedHash),
    FiringPathfinderIdempotencyConflictError,
  );
  assert.throws(
    () => assertFiringPathfinderIdempotencyMatch(originalHash, changedDeliveryHash),
    FiringPathfinderIdempotencyConflictError,
  );
  assert.throws(
    () => assertFiringPathfinderIdempotencyMatch(undefined, originalHash),
    FiringPathfinderIdempotencyConflictError,
  );
});

test("billing ticket IDs use validated request dates with a stable legacy fallback", () => {
  const legacyTicketId = makeFiringTicketId(validRequest.clientRequestId);
  assert.match(legacyTicketId, /^MF-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  assert.equal(makeFiringTicketId(validRequest.clientRequestId), legacyTicketId);
  assert.notEqual(makeFiringTicketId("fp_fedcba0987654321"), legacyTicketId);
  assert.notEqual(legacyTicketId, validSubmission.artifact.id);

  const datedRequestId = "fp_20260711_1234567890abcdef";
  const datedTicketId = makeFiringTicketId(datedRequestId);
  assert.equal(datedTicketId, "MF-0711-BXUM");
  assert.match(datedTicketId, /^MF-0711-[0-9BCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  assert.equal(makeFiringTicketId(datedRequestId), datedTicketId);
  assert.notEqual(makeFiringTicketId("fp_20260711_fedcba0987654321"), datedTicketId);

  const invalidDateTicketId = makeFiringTicketId("fp_20260230_1234567890abcdef");
  assert.match(invalidDateTicketId, /^MF-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  assert.doesNotMatch(invalidDateTicketId, /^MF-0230-/);
  assert.match(
    makeFiringTicketId("fp_20240229_1234567890abcdef"),
    /^MF-0229-[0-9BCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
  );
  assert.match(
    makeFiringTicketId("fp_20230229_1234567890abcdef"),
    /^MF-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/,
  );
});

test("HTML email is styled, structured, and escapes artist content", () => {
  const html = formatFiringPathfinderEmailHtml(
    validSubmission,
    "MF-ABCD-1234-EF56",
    "2026-07-10T20:00:00.000Z",
  );
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Studio question/);
  assert.match(html, /MF-ABCD-1234-EF56/);
  assert.match(html, /<table role="presentation"/);
  assert.match(html, /Details from the artist/);
  assert.doesNotMatch(html, /Up to \$65 — whole kiln|No estimate yet/);
  assert.match(html, /Tall handle &amp; &lt;careful&gt; placement/);
  assert.doesNotMatch(html, /Tall handle & <careful>/);
  assert.match(html, /not a firing booking or billable event/);
  assert.doesNotMatch(html, /Kilnfire/i);
});

test("artist email is a distinct HTML packet with dropoff, risk, transport, and policy guidance", () => {
  const submission = materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "double" },
  });
  const html = formatFiringPathfinderArtistEmailHtml(
    submission,
    "MF-0711-BXUM",
    "2026-07-10T20:00:00.000Z",
  );
  const text = formatFiringPathfinderArtistEmailText(
    submission,
    "MF-0711-BXUM",
    "2026-07-10T20:00:00.000Z",
  );
  for (const body of [html, text]) {
    assert.match(body, /What happens now/);
    assert.match(body, /Kiln blessings: the short risk version/);
    assert.match(body, /Getting the work here safely/);
    assert.match(body, /Studio policies, in human terms/);
    assert.match(body, /private address and gate instructions separately/);
    assert.match(body, /paper ticket is optional/i);
    assert.match(body, /Wait for those details before traveling/);
    assert.match(body, /3–7 days from drop-off/);
    assert.match(body, /does not reserve a firing date/);
    assert.match(body, /rack is available 24\/7/);
    assert.match(body, /19 days and 6 hours/);
    assert.match(body, /other remedies are reviewed case by case/);
    assert.match(body, /Terms \(2026-07-18\)|Terms 2026-07-18/);
    assert.match(body, /Privacy(?: notice)? \(2026-07-18\)|Privacy 2026-07-18/);
    assert.match(body, /MF-0711-BXUM/);
    assert.doesNotMatch(body, /Kilnfire/i);
  }
  assert.match(html, /Tall handle &amp; &lt;careful&gt; placement/);
  assert.doesNotMatch(html, /Tall handle & <careful>/);
});

test("v3 dropoff email omits clay work, renders kiln space, and routes the ticket to the tray", () => {
  const submission = materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "mid", spaceId: "double" },
  });
  const ticketId = "MF-1111-2222-3333";
  const html = formatFiringPathfinderEmailHtml(submission, ticketId, "2026-07-10T20:00:00.000Z");
  const text = formatFiringPathfinderEmailText(submission, ticketId, "2026-07-10T20:00:00.000Z");
  for (const body of [html, text]) {
    assert.match(body, /A dropoff is expected/);
    assert.match(body, /Add this emailed ticket to the firing intake tray/);
    assert.match(body, /Two half shelves/);
    assert.match(body, /\$70 estimated/);
    assert.match(body, /This is an estimate\. You pay after the firing for the space your work used\./);
    assert.match(body, /If something goes wrong because of us, there’s no firing charge\./);
    assert.match(body, /If the issue comes from the clay, glaze, or construction, the firing is still charged\./);
    assert.doesNotMatch(body, /Your work/);
    assert.doesNotMatch(body, /\bnull\b|undefined/);
  }
  const documents = buildFiringPathfinderSubmissionDocuments(
    submission,
    ticketId,
    "pathfinder-v3-mid",
    "pathfinder-v3-mid-email",
    Timestamp.fromMillis(1_000),
    "2026-07-10T20:00:00.000Z",
  );
  const subject = (documents.mail as { message: { subject: string } }).message.subject;
  assert.equal(subject, `Firing ticket ${ticketId} from Sam Potter: Mid fire · Two half shelves`);
  assert.doesNotMatch(subject, /null|undefined|Stoneware|Earthenware/i);
  assert.equal((documents.supportRequest as { spaceId: string }).spaceId, "double");
  assert.equal((documents.supportRequest as { deliveryMode: string }).deliveryMode, "email");
  const artistMail = documents.artistMail as {
    to: string;
    replyTo: string;
    message: { subject: string; text: string; html: string };
  };
  assert.equal(artistMail.to, "sam@example.com");
  assert.equal(artistMail.replyTo, "support@monsoonfire.com");
  assert.equal(artistMail.message.subject, `Your Monsoon Fire ticket ${ticketId}`);
  assert.match(artistMail.message.html, /Kiln blessings/);

  const both = materializeFiringPathfinderSubmission({ ...submission, deliveryMode: "both" });
  const bothHtml = formatFiringPathfinderEmailHtml(both, ticketId, "2026-07-10T20:00:00.000Z");
  const bothText = formatFiringPathfinderEmailText(both, ticketId, "2026-07-10T20:00:00.000Z");
  for (const body of [bothHtml, bothText]) {
    assert.match(body, /matching printed copy with the work/);
    assert.match(body, /do not make another printed copy/);
  }

  const nonDropoffSelections: FiringPathfinderSelection[] = [
    { modelVersion: 1, intentId: "pickup", workId: null, heatId: null },
    { modelVersion: 3, intentId: "collection", workId: null, heatId: null, spaceId: null },
    { modelVersion: 3, intentId: "readiness", workId: null, heatId: null, spaceId: null },
    { modelVersion: 3, intentId: "question", workId: "unknown", heatId: "unknown", spaceId: null },
  ];
  for (const selection of nonDropoffSelections) {
    const nonDropoff = materializeFiringPathfinderSubmission({ ...validRequest, selection });
    const nonDropoffText = formatFiringPathfinderEmailText(
      nonDropoff,
      ticketId,
      "2026-07-10T20:00:00.000Z",
    );
    assert.doesNotMatch(
      nonDropoffText,
      /dropoff is expected|firing intake tray|matching printed copy|this is an estimate/i,
    );
    assert.doesNotMatch(nonDropoffText, /Price:|Maximum estimate|No estimate yet|Up to \$65/i);
    assert.doesNotMatch(nonDropoffText, /completely dry|dryness/i);
  }
});

test("email summary collapses duplicate firing rows and omits non-applicable ranges", () => {
  const midSubmission = materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 2, intentId: "dropoff", workId: "stoneware", heatId: "mid" },
  });
  const midHtml = formatFiringPathfinderEmailHtml(midSubmission, "pathfinder-mid", "2026-07-10T20:00:00.000Z");
  assert.equal(midHtml.match(/Mid fire/g)?.length, 1);
  assert.doesNotMatch(midHtml, /Likely firing/);

  const pickupSubmission = materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 2, intentId: "collection", workId: null, heatId: null },
  });
  const pickupHtml = formatFiringPathfinderEmailHtml(pickupSubmission, "pathfinder-pickup", "2026-07-10T20:00:00.000Z");
  assert.doesNotMatch(pickupHtml, /Firing range/);
  assert.doesNotMatch(pickupHtml, /Not applicable/);
  assert.doesNotMatch(pickupHtml, /Price|No new estimate/);
});

test("pickup reminder is useful without estimating, rebilling, or making the artist re-plan", () => {
  const submission = materializeFiringPathfinderSubmission({
    ...validRequest,
    selection: { modelVersion: 3, intentId: "collection", workId: null, heatId: null, spaceId: null },
  });
  const ticketId = "MF-0713-PICK";
  const html = formatFiringPathfinderArtistEmailHtml(submission, ticketId, "2026-07-13T20:00:00.000Z");
  const text = formatFiringPathfinderArtistEmailText(submission, ticketId, "2026-07-13T20:00:00.000Z");
  for (const body of [html, text]) {
    assert.match(body, /Your pickup reminder/);
    assert.match(body, /Your work is waiting for you/);
    assert.match(body, /private address/);
    assert.match(body, /Standard pickup is self-serve/);
    assert.match(body, /Pad the pieces/);
    assert.match(body, /reply to this email/i);
    assert.doesNotMatch(body, /Price|estimate|billable/i);
  }

  const documents = buildFiringPathfinderSubmissionDocuments(
    submission,
    ticketId,
    "pathfinder-pickup",
    "pathfinder-pickup-email",
    Timestamp.fromMillis(1_000),
    "2026-07-13T20:00:00.000Z",
  );
  assert.equal(
    (documents.mail as { message: { subject: string } }).message.subject,
    `Pickup details ${ticketId} for Sam Potter`,
  );
  assert.equal(
    (documents.artistMail as { message: { subject: string } }).message.subject,
    `Your Monsoon Fire pickup reminder ${ticketId}`,
  );
  assert.equal(documents.ticket.status, "pickup_details_requested");
  assert.equal(documents.ticket.billingStatus, "not_applicable");
  assert.equal((documents.supportRequest as { category: string }).category, "Pickup");
});

test("studio-question documents fix the recipient and persist non-billable support state", () => {
  const ticketId = makeFiringTicketId(validRequest.clientRequestId);
  const documents = buildFiringPathfinderSubmissionDocuments(
    validSubmission,
    ticketId,
    "pathfinder-abc123",
    "pathfinder-abc123-email",
    Timestamp.fromMillis(1_000),
    "2026-07-10T20:00:00.000Z",
  );
  const mail = documents.mail as {
    to: string;
    replyTo: string;
    message: { subject: string; text: string; html: string };
  };
  assert.equal(mail.to, "support@monsoonfire.com");
  assert.equal(mail.replyTo, "sam@example.com");
  assert.equal(mail.message.subject, `Studio question ${ticketId} from Sam Potter: Mixed, large, or unusual work`);
  assert.match(mail.message.html, /Studio question/);
  assert.match(mail.message.text, /Monsoon Fire studio question/);
  const artistMail = documents.artistMail as {
    to: string;
    replyTo: string;
    message: { subject: string; text: string; html: string };
  };
  assert.equal(artistMail.to, "sam@example.com");
  assert.equal(artistMail.replyTo, "support@monsoonfire.com");
  assert.equal(artistMail.message.subject, `Your Monsoon Fire studio question ${ticketId}`);
  assert.match(artistMail.message.html, /Your studio question/);
  assert.match(artistMail.message.text, /Questions\? Reply to this email/);
  assert.equal((documents.supportRequest as { status: string; deliveryMode: string }).status, "new");
  assert.equal((documents.supportRequest as { deliveryMode: string }).deliveryMode, "email");
  assert.deepEqual(documents.ticket, {
    ticketId,
    uid: "anonymous-firing-pathfinder",
    ownerUid: null,
    status: "support_requested",
    billingStatus: "not_applicable",
    billingVersion: 0,
    noticeStatus: "not_applicable",
    source: "firing-pathfinder",
    channel: "website",
    pagePath: validSubmission.pagePath,
    displayName: "Sam Potter",
    email: "sam@example.com",
    consentToContact: true,
    legalAcceptance: {
      ...validRequest.legalAcceptance,
      acceptedAt: Timestamp.fromMillis(1_000),
    },
    artistNote: "Tall handle & <careful> placement",
    deliveryMode: "email",
    selection: validSubmission.selection,
    spaceId: null,
    estimatedSpace: null,
    estimateNote: null,
    artifact: validSubmission.artifact,
    clientRequestId: validSubmission.clientRequestId,
    payloadHash: makeFiringPathfinderPayloadHash(validSubmission),
    supportRequestId: "pathfinder-abc123",
    emailQueueId: "pathfinder-abc123-email",
    artistEmailQueueId: "pathfinder-abc123-email-artist",
    createdAt: Timestamp.fromMillis(1_000),
    updatedAt: Timestamp.fromMillis(1_000),
  });
});

test("print-only issues an unbilled ticket without support or mail documents", () => {
  const parsed = firingPathfinderSubmissionSchema.parse({
    ...validRequest,
    deliveryMode: "print",
    email: "",
    consentToContact: false,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "low", spaceId: "half" },
  });
  const submission = materializeFiringPathfinderSubmission(parsed);
  const ticketId = makeFiringTicketId(submission.clientRequestId);
  const documents = buildFiringPathfinderSubmissionDocuments(
    submission,
    ticketId,
    null,
    null,
    Timestamp.fromMillis(2_000),
    "2026-07-10T20:00:00.000Z",
  );

  assert.equal(documents.supportRequest, null);
  assert.equal(documents.mail, null);
  assert.equal(documents.artistMail, null);
  assert.equal(documents.ticket.status, "issued");
  assert.equal(documents.ticket.billingStatus, "unbilled");
  assert.equal(documents.ticket.email, null);
  assert.equal(documents.ticket.supportRequestId, null);
  assert.equal(documents.ticket.emailQueueId, null);
  assert.equal(documents.ticket.artistEmailQueueId, null);
});

test("handler accepts one valid request and reports the stable reference", async () => {
  const res = makeResponse();
  const persisted: FiringPathfinderSubmission[] = [];
  let configuredRateMax = 0;
  await handleFiringPathfinderRequest(makeRequest(validRequest), res.response, {
    rateLimit: async (params) => {
      configuredRateMax = params.max;
      return { ok: true };
    },
    persist: async (submission) => {
      persisted.push(submission);
      return {
        ticketId: "MF-ABCD-1234-EF56",
        supportRequestId: "pathfinder-abc123",
        emailQueueId: "pathfinder-abc123-email",
        emailQueued: true,
        duplicate: false,
      };
    },
  });

  assert.equal(res.read().statusCode, 200);
  assert.equal(configuredRateMax, 12);
  assert.equal(persisted[0]?.email, "sam@example.com");
  assert.equal(persisted[0]?.artifact.price, "No estimate yet");
  assert.deepEqual(res.read().body, {
    ok: true,
    data: {
      ticketId: "MF-ABCD-1234-EF56",
      supportRequestId: "pathfinder-abc123",
      emailQueued: true,
      duplicate: false,
    },
    requestId: (res.read().body as { requestId: string }).requestId,
  });
});

test("handler returns a permanent ticket ID without claiming print-only email was queued", async () => {
  const parsedPrintRequest = firingPathfinderSubmissionSchema.parse({
    ...validRequest,
    deliveryMode: "print",
    email: "",
    consentToContact: false,
    selection: { modelVersion: 3, intentId: "dropoff", workId: null, heatId: "low", spaceId: "half" },
  });
  const res = makeResponse();
  await handleFiringPathfinderRequest(makeRequest(parsedPrintRequest), res.response, {
    rateLimit: async () => ({ ok: true }),
    persist: async () => ({
      ticketId: "MF-1111-2222-3333",
      supportRequestId: null,
      emailQueueId: null,
      emailQueued: false,
      duplicate: false,
    }),
  });

  assert.equal(res.read().statusCode, 200);
  assert.deepEqual(res.read().body, {
    ok: true,
    data: {
      ticketId: "MF-1111-2222-3333",
      emailQueued: false,
      duplicate: false,
    },
    requestId: (res.read().body as { requestId: string }).requestId,
  });
});

test("handler reports an idempotency conflict without claiming the changed request was queued", async () => {
  const res = makeResponse();
  await handleFiringPathfinderRequest(makeRequest(validRequest), res.response, {
    rateLimit: async () => ({ ok: true }),
    persist: async () => {
      throw new FiringPathfinderIdempotencyConflictError();
    },
  });

  assert.equal(res.read().statusCode, 409);
  assert.deepEqual(res.read().body, {
    ok: false,
    code: "IDEMPOTENCY_CONFLICT",
    message: "This request belongs to an earlier plan. Start a new plan to send different details.",
    requestId: (res.read().body as { requestId: string }).requestId,
  });
});

test("handler fails closed on rate limiting and never persists", async () => {
  const res = makeResponse();
  let persistCalled = false;
  await handleFiringPathfinderRequest(makeRequest(validRequest), res.response, {
    rateLimit: async () => ({ ok: false, retryAfterMs: 30_000 }),
    persist: async () => {
      persistCalled = true;
      throw new Error("should not run");
    },
  });

  assert.equal(res.read().statusCode, 429);
  assert.equal(res.read().headers["Retry-After"], "30");
  assert.match(
    (res.read().body as { message: string }).message,
    /^Too many requests from this connection\. Try again in about 1 minute\. Your answers are still here\.$/,
  );
  assert.equal(persistCalled, false);
});

test("handler reports a failed request without exposing ticket mechanics", async () => {
  const res = makeResponse();
  await handleFiringPathfinderRequest(makeRequest(validRequest), res.response, {
    rateLimit: async () => ({ ok: true }),
    persist: async () => {
      throw new Error("database unavailable");
    },
  });

  assert.equal(res.read().statusCode, 500);
  assert.equal(
    (res.read().body as { message: string }).message,
    "We couldn’t send your request. Your answers are still here.",
  );
});

test("handler rejects malformed requests before persistence", async () => {
  const res = makeResponse();
  await handleFiringPathfinderRequest(
    makeRequest({ ...validRequest, website: "spam.example" }),
    res.response,
    {
      rateLimit: async () => ({ ok: true }),
      persist: async () => {
        throw new Error("should not run");
      },
    },
  );

  assert.equal(res.read().statusCode, 400);
});
