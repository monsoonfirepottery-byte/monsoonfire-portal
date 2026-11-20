import { describe, expect, it } from "vitest";
import {
  demoReducer,
  estimateBillingNote,
  formatReceipt,
  getGuidance,
  getJourneyPresentation,
  getReceipt,
  getSpaceChoicePriceHint,
  initialState,
  spaceChoices,
} from "./demoModel.js";

const sharedBillingPolicy =
  "This is an estimate. You pay after the firing for the space your work used. If something goes wrong because of us, there’s no firing charge. If the issue comes from the clay, glaze, or construction, the firing is still charged.";

const standardSelfServeNote =
  "If you’re shy, that’s fine — we’re shy too. Standard dropoff and pickup do not require a conversation; follow the dropoff instructions or ready email and you’re good to go.";

const dropoffLifecycleNote =
  "After you finish, your ticket arrives by email. The studio confirms the private address and gate instructions separately; wait for those details before traveling. When the work is ready, we’ll email you to pick it up.";

function reduce(actions) {
  return actions.reduce(demoReducer, { ...initialState });
}

function dropoffGuidance(heatId, spaceId) {
  return reduce([
    { type: "select-entry", entryId: "dropoff" },
    { type: "select-heat", heatId },
    { type: "select-space", spaceId },
  ]);
}

describe("kiln path model", () => {
  it("starts with no assumed task or route", () => {
    expect(initialState).toMatchObject({
      entryId: null,
      intentId: null,
      heatId: null,
      spaceId: null,
      phase: "orient",
    });
    expect(getJourneyPresentation(initialState)).toMatchObject({
      routeIds: ["orient"],
      focusStageId: "orient",
      supportActive: false,
    });
    expect(getGuidance(initialState)).toBeNull();
  });

  it("moves from task to firing range to visual space without a clay-body intake step", () => {
    const heatState = reduce([{ type: "select-entry", entryId: "dropoff" }]);
    expect(heatState).toMatchObject({ intentId: "dropoff", phase: "heat", workId: null });

    const spaceState = demoReducer(heatState, { type: "select-heat", heatId: "mid" });
    expect(spaceState).toMatchObject({ phase: "space", heatId: "mid", workId: null, spaceId: null });

    const guidanceState = demoReducer(spaceState, { type: "select-space", spaceId: "half" });
    expect(guidanceState).toMatchObject({ phase: "guidance", heatId: "mid", workId: null, spaceId: "half" });
  });

  it("offers distinct one, two, three, four-plus, and unsure space estimates", () => {
    expect(Object.keys(spaceChoices)).toEqual(["half", "double", "triple", "large", "unknown"]);
    expect(Object.values(spaceChoices).map(({ id, label, receiptLabel, units }) => ({
      id,
      label,
      receiptLabel,
      units,
    }))).toEqual([
      { id: "half", label: "1 half shelf", receiptLabel: "One half shelf", units: 1 },
      { id: "double", label: "2 half shelves", receiptLabel: "Two half shelves", units: 2 },
      { id: "triple", label: "3 half shelves", receiptLabel: "Three half shelves", units: 3 },
      { id: "large", label: "4 or more half shelves", receiptLabel: "Four or more half shelves / whole kiln", units: null },
      { id: "unknown", label: "I’m not sure", receiptLabel: "Space needs studio check", units: null },
    ]);
  });

  it.each([
    ["low", "half", "$20 estimated"],
    ["low", "double", "$40 estimated"],
    ["low", "triple", "$60 estimated"],
    ["mid", "half", "$35 estimated"],
    ["mid", "double", "$70 estimated"],
  ])("prices %s fire with %s space from the numeric shelf matrix", (heatId, spaceId, price) => {
    expect(getGuidance(dropoffGuidance(heatId, spaceId))).toMatchObject({
      priceLabel: "Estimated price",
      price,
    });
  });

  it("charges three mid-fire half shelves without applying the four-shelf cap early", () => {
    expect(getGuidance(dropoffGuidance("mid", "triple"))).toMatchObject({priceLabel: "Estimated price", price: "$105 estimated", spaceLabel: "Three half shelves"});
  });

  it.each([
    ["low", {kind: "estimate", text: "Heads-up · about $40"}],
    ["mid", {kind: "estimate", text: "Heads-up · about $70"}],
    ["high", {kind: "estimate", text: "Heads-up · about $90"}],
    ["custom", {kind: "unknown", text: "Studio quote required"}],
    ["unknown", {kind: "unknown", text: "Studio checks it at dropoff"}],
  ])("labels the double-space boundary for %s fire", (heatId, expected) => {
    expect(getSpaceChoicePriceHint(heatId, "double")).toEqual(expected);
  });

  it.each([["low",80],["mid",120]])("caps four or more half shelves for %s at %s", (heatId, cap) => {
    expect(getSpaceChoicePriceHint(heatId,"large")).toEqual({kind:"maximum",text:`Heads-up · up to $${cap}`});
    expect(getGuidance(dropoffGuidance(heatId,"large"))).toMatchObject({priceLabel:"Maximum estimate",price:`Up to $${cap} — per-client base cap`});
  });

  it("requires a separate custom quote rather than using the shared-firing cap", () => {
    expect(getGuidance(dropoffGuidance("custom","half"))).toMatchObject({routeName:"Custom firing",priceLabel:"Price",price:"No estimate yet"});
    expect(getSpaceChoicePriceHint("custom","large")).toEqual({kind:"unknown",text:"Studio quote required"});
    expect(getSpaceChoicePriceHint("unknown","large")).toEqual({kind:"unknown",text:"Studio checks it at dropoff"});
  });

  it("does not invent a price when either firing range or space is unknown", () => {
    expect(getGuidance(dropoffGuidance("unknown", "half"))).toMatchObject({
      routeName: "Fit check",
      price: "No estimate yet",
    });
    expect(getGuidance(dropoffGuidance("mid", "unknown"))).toMatchObject({
      routeName: "Fit check",
      price: "No estimate yet",
      spaceLabel: "Space needs studio check",
    });
  });

  it("turns a sized dropoff into a version-3 plan without inventing a clay body", () => {
    const guidanceState = dropoffGuidance("mid", "double");
    expect(getGuidance(guidanceState)).toMatchObject({
      routeName: "Mid fire",
      title: "Your mid-fire dropoff.",
      price: "$70 estimated",
      spaceLabel: "Two half shelves",
      billingPolicy: sharedBillingPolicy,
      billingTitle: "Estimate now. Pay after firing.",
      showInputList: false,
      selfServeNote: standardSelfServeNote,
    });

    const receiptState = demoReducer(guidanceState, { type: "confirm-next-step" });
    const receipt = getReceipt(receiptState);
    expect(receipt).toMatchObject({
      modelVersion: 3,
      intentId: "dropoff",
      workId: null,
      heatId: "mid",
      spaceId: "double",
      work: null,
      heat: "Mid fire",
      space: "Two half shelves",
      routeName: "Mid fire",
      estimateNote: estimateBillingNote,
      showInputList: false,
      selfServeNote: standardSelfServeNote,
      lifecycleNote: dropoffLifecycleNote,
    });

    const copied = formatReceipt(receipt, "MF-0711-BXUM");
    expect(copied).toContain("Monsoon Fire firing plan · reference MF-0711-BXUM");
    expect(copied).toContain("Firing range: Mid fire");
    expect(copied).toContain("Estimated space: Two half shelves");
    expect(copied).toContain(estimateBillingNote);
    expect(copied).toContain(dropoffLifecycleNote);
    expect(copied).not.toContain("Details:");
    expect(copied).not.toContain("Your work:");
    expect(copied).not.toContain("Likely firing:");
  });

  it("uses the exact shared billing policy in Stage 04 guidance and the final dropoff ticket", () => {
    expect(estimateBillingNote).toBe(sharedBillingPolicy);

    const guidanceState = dropoffGuidance("low", "triple");
    expect(getGuidance(guidanceState).billingPolicy).toBe(sharedBillingPolicy);

    const receipt = getReceipt(demoReducer(guidanceState, { type: "confirm-next-step" }));
    expect(receipt.estimateNote).toBe(sharedBillingPolicy);
    expect(formatReceipt(receipt, "MF-0711-PAY1")).toContain(sharedBillingPolicy);
  });

  it("routes an unsure question to a distinct quick-answer path without presenting a price", () => {
    const state = reduce([
      { type: "select-entry", entryId: "other" },
      { type: "select-question", questionId: "unsure" },
    ]);
    expect(getGuidance(state)).toMatchObject({
      variant: "support",
      routeName: "Fit check",
      answerTitle: "Look for Low, Mid, or High on the clay or glaze label.",
    });
    expect(getGuidance(state).inputs).toContain("Firing range, if known");
    expect(JSON.stringify(getGuidance(state))).not.toMatch(/photos?/i);
    expect(getJourneyPresentation(state)).toMatchObject({ mode: "support", supportActive: true, focusStageId: "choose" });
  });

  it("does not request photos in any reachable guidance branch", () => {
    const states = [
      dropoffGuidance("low", "half"),
      dropoffGuidance("mid", "double"),
      dropoffGuidance("custom", "large"),
      dropoffGuidance("unknown", "unknown"),
      reduce([{ type: "select-entry", entryId: "pickup" }]),
      reduce([
        { type: "select-entry", entryId: "other" },
        { type: "select-question", questionId: "readiness" },
      ]),
      reduce([
        { type: "select-entry", entryId: "other" },
        { type: "select-question", questionId: "unusual" },
      ]),
      reduce([
        { type: "select-entry", entryId: "other" },
        { type: "select-question", questionId: "unsure" },
      ]),
    ];

    for (const state of states) {
      expect(JSON.stringify(getGuidance(state))).not.toMatch(/photos?/i);
    }
  });

  it("keeps unusual-work help out of the estimator presentation", () => {
    const state = reduce([
      { type: "select-entry", entryId: "other" },
      { type: "select-question", questionId: "unusual" },
    ]);
    expect(getGuidance(state)).toMatchObject({
      variant: "support",
      routeName: "Fit check",
      answerTitle: "Tell us what makes it unusual.",
    });
    const receipt = getReceipt(demoReducer(state, { type: "confirm-next-step" }));
    expect(formatReceipt(receipt)).not.toMatch(/price|estimate|\$65/i);
  });

  it("uses safe travel as the observable readiness rule and lets the studio hold the work", () => {
    const readiness = reduce([
      { type: "select-entry", entryId: "other" },
      { type: "select-question", questionId: "readiness" },
    ]);
    expect(readiness.intentId).toBe("readiness");
    expect(getGuidance(readiness)).toMatchObject({
      variant: "support",
      routeName: "Ready check",
      title: "If it can travel safely, bring it.",
    });
    expect(getGuidance(readiness).answer).toMatch(/we can hold it until it is actually ready for the kiln/i);
    expect(JSON.stringify(getGuidance(readiness))).not.toMatch(/completely dry|dryness/i);

    const pickup = reduce([{ type: "select-entry", entryId: "pickup" }]);
    expect(pickup.intentId).toBe("collection");
    expect(getGuidance(pickup)).toMatchObject({
      variant: "pickup",
      routeName: "Pickup",
      title: "Your work is waiting for you.",
      highlight: "Fired, cooled, and set aside",
    });
    expect(JSON.stringify(getGuidance(pickup))).not.toMatch(/live status|wait for a ready|price box/i);
  });

  it("keeps dry-work judgment out of standard low- and mid-fire guidance", () => {
    for (const heatId of ["low", "mid"]) {
      const guidance = getGuidance(dropoffGuidance(heatId, "half"));
      expect(guidance.risk).toMatch(/packed and travel safely/i);
      expect(guidance.risk).toMatch(/wipe glaze off the bottom and foot/i);
      expect(guidance.risk).toMatch(/we can hold it until it is ready to fire/i);
      expect(guidance.risk).not.toMatch(/label each piece/i);
      expect(JSON.stringify(guidance)).not.toMatch(/completely dry|dryness/i);
    }
  });

  it("keeps standard guidance self-serve and hides its input checklist", () => {
    for (const heatId of ["low", "mid"]) {
      const guidance = getGuidance(dropoffGuidance(heatId, "half"));
      expect(guidance).toMatchObject({
        showInputList: false,
        selfServeNote: standardSelfServeNote,
        billingTitle: "Estimate now. Pay after firing.",
        billingPolicy: sharedBillingPolicy,
      });
    }

    expect(getGuidance(dropoffGuidance("custom", "half"))).toMatchObject({
      showInputList: true,
      selfServeNote: null,
    });
  });

  it("keeps pre-submit copied dropoff plans free of ticket-system mechanics", () => {
    const guidanceState = dropoffGuidance("low", "half");
    const receipt = getReceipt(demoReducer(guidanceState, { type: "confirm-next-step" }));
    const copied = formatReceipt(receipt);

    expect(copied).toContain("Monsoon Fire firing plan");
    expect(copied).toContain(dropoffLifecycleNote);
    expect(copied).not.toMatch(/permanent id|ticket issued|nothing has been submitted|no ticket/i);
  });

  it("keeps the after-fire billing note off non-dropoff tickets and copied text", () => {
    const guidanceState = reduce([
      { type: "select-entry", entryId: "other" },
      { type: "select-question", questionId: "readiness" },
    ]);
    const receipt = getReceipt(demoReducer(guidanceState, { type: "confirm-next-step" }));

    expect(receipt.estimateNote).toBeNull();
    expect(formatReceipt(receipt, "MF-0711-C7DQ")).not.toContain(sharedBillingPolicy);
  });

  it("backs up one task-specific step while preserving earlier choices", () => {
    const spaceState = reduce([
      { type: "select-entry", entryId: "dropoff" },
      { type: "select-heat", heatId: "mid" },
    ]);
    expect(demoReducer(spaceState, { type: "back" })).toMatchObject({
      phase: "heat",
      heatId: "mid",
      spaceId: null,
    });

    const guidanceState = demoReducer(spaceState, { type: "select-space", spaceId: "double" });
    expect(demoReducer(guidanceState, { type: "back" })).toMatchObject({
      phase: "space",
      heatId: "mid",
      spaceId: "double",
    });

    const pickup = reduce([{ type: "select-entry", entryId: "pickup" }]);
    expect(demoReducer(pickup, { type: "back" })).toEqual({ ...initialState });
  });
});
