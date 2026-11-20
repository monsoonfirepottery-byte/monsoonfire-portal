import serviceCatalog from "../../agent-service-catalog.json";
import kilnCare from "./assets/kiln-care.webp";
import pickupShelf from "./assets/pickup-shelf.webp";
import studioTable from "./assets/studio-table.webp";

export const stages = Object.freeze([
  { id: "orient", number: "1", label: "Start here", category: "start" },
  { id: "choose", number: "2", label: "Plan firing", category: "fit" },
  { id: "dropoff", number: "3", label: "Drop off", category: "fit" },
  { id: "kiln", number: "4", label: "We fire", category: "fire" },
  { id: "updates", number: "5", label: "Updates", category: "return" },
  { id: "ready", number: "6", label: "Ready notice", category: "return" },
  { id: "pickup", number: "7", label: "Pick up", category: "return" },
]);

export const entryChoices = Object.freeze({
  dropoff: {
    id: "dropoff",
    label: "Drop off work",
    description: "Estimate a standard firing and request dropoff instructions.",
  },
  pickup: {
    id: "pickup",
    label: "Pick up finished work",
    description: "Your ready email has the current pickup details. Need another copy? We can send one.",
  },
  other: {
    id: "other",
    label: "Ask something else",
    description: "Ask about readiness, unusual work, firing range, or studio access.",
  },
});

export const questionChoices = Object.freeze({
  readiness: {
    id: "readiness",
    label: "Is my unfired work ready to bring in?",
    description: "Check whether it can be packed and make the trip safely.",
    eyebrow: "Safe to travel",
    action: "Read the quick check",
  },
  unusual: {
    id: "unusual",
    label: "I have something unusual",
    description: "Ask about size, materials, attachments, or special handling.",
    eyebrow: "Fit + handling",
    action: "See what helps",
  },
  unsure: {
    id: "unsure",
    label: "I’m not sure what firing I need",
    description: "Start with the firing range question and tell us what you know.",
    eyebrow: "Firing range",
    action: "Find a starting point",
  },
});

export const quickFaqAnswers = Object.freeze([
  {
    id: "first-visit",
    question: "First visit, or waiting for directions?",
    answer: "Email the studio for the address and gate instructions. The automatic ticket email records your request; the studio confirms private access details separately. Check spam or reply to your ticket email if they have not arrived. Wait for those details before traveling.",
  },
  {
    id: "optional-ticket",
    question: "Do I need an account or ticket?",
    answer: "No account is needed, and the planner is optional. Already have access instructions? Leave your name, email, requested firing, and material details with your work. Small batches are welcome.",
  },
  {
    id: "pickup-timing",
    question: "Need a different pickup time?",
    answer: "Once you have the ready email and access instructions, the outdoor pickup rack is available 24/7. If you need help or a different handoff arrangement, reply before traveling.",
  },
  {
    id: "ticket-update",
    question: "Something changed after you sent your ticket?",
    answer: "Reply to the ticket email with the reference, what changed, and any date that matters. Staff will confirm what can still be adjusted.",
  },
]);

export const intents = Object.freeze({
  new: {
    id: "new",
    label: "I’m not sure what firing I need",
    shortLabel: "an unsure firing",
    eyebrow: "Start with what you know",
    description: "I’d like help figuring out the clay, glaze, size, and right temperature.",
    route: stages.map((stage) => stage.id),
  },
  known: {
    id: "known",
    label: "I know the clay and firing range",
    shortLabel: "a known firing",
    eyebrow: "Check the fit before the drive",
    description: "I’m looking for the likely firing, an example price, and what to bring.",
    route: ["choose", "dropoff", "kiln", "updates", "ready", "pickup"],
  },
  dropoff: {
    id: "dropoff",
    label: "Drop off work",
    shortLabel: "a dropoff",
    eyebrow: "Plan an easy handoff",
    description: "I want to make sure the studio has what it needs before I bring my work.",
    route: ["dropoff", "kiln", "updates", "ready", "pickup"],
  },
  pickup: {
    id: "pickup",
    label: "Is my unfired work ready to bring in?",
    shortLabel: "a readiness check",
    eyebrow: "Check it before the drive",
    description: "I’m deciding whether my unfired work can make the trip safely.",
    route: ["choose", "dropoff", "kiln", "updates", "ready", "pickup"],
  },
  readiness: {
    id: "readiness",
    label: "Is my unfired work ready to bring in?",
    shortLabel: "a readiness check",
    eyebrow: "Check it before the drive",
    description: "I’m deciding whether my unfired work can make the trip safely.",
    route: ["choose", "dropoff", "kiln", "updates", "ready", "pickup"],
  },
  unusual: {
    id: "unusual",
    label: "I have something unusual",
    shortLabel: "an unusual piece",
    eyebrow: "Let’s take a closer look",
    description: "My material, shape, size, or firing plan needs a closer look.",
    route: ["choose", "support"],
  },
  collection: {
    id: "collection",
    label: "Pick up finished work",
    shortLabel: "a pickup",
    eyebrow: "The finish line",
    description: "My ready note arrived and I’m getting the pickup details.",
    route: ["ready", "pickup"],
  },
  question: {
    id: "question",
    label: "I’m not sure what firing I need",
    shortLabel: "an unsure firing",
    eyebrow: "Start with what you know",
    description: "I want staff to help identify a safe firing range.",
    route: ["choose", "support"],
  },
});

const supportWorkLabels = Object.freeze({
  large: "Mixed, large, or unusual work",
  unknown: "Work needs identification",
});

export const heatChoices = Object.freeze({
  low: {
    id: "low",
    label: "Low fire",
    description: "Bisque: the first firing of unfired work, including mid-fire stoneware. Also for compatible low-fire glazes.",
    coneHelp: "Cone reference: typically cone 06–04.",
    serviceId: "low-fire",
  },
  mid: {
    id: "mid",
    label: "Mid fire",
    description: "Glaze firing: work already bisqued and glazed with materials suitable for our usual cone 5.5 firing.",
    coneHelp: "Cone reference: typically cone 5–6.",
    serviceId: "medium-fire",
  },
  high: {
    id: "high",
    label: "Cone 10 electric oxidation",
    description: "Shared runs require scheduling confirmation. Send the exact clay and glaze labels before traveling.",
    coneHelp: "Cone reference: use the clay body and glaze labels; ask us if they do not match.",
    serviceId: "high-fire",
  },
  custom: {
    id: "custom",
    label: "Special / custom firing",
    description: "For unusual firing requirements that need a conversation and a custom quote.",
    coneHelp: "Firing range and schedule are set with the studio before anything is fired.",
    serviceId: "custom-firing",
  },
  unknown: {
    id: "unknown",
    label: "I’m not sure",
    description: "That’s okay. We’ll help you check before we estimate or fire it.",
    serviceId: null,
  },
});

export const spaceChoices = Object.freeze({
  half: {
    id: "half",
    label: "1 half shelf",
    description: "Fits one D-shaped shelf, all under 10 inches.",
    receiptLabel: "One half shelf",
    units: 1,
  },
  double: {
    id: "double",
    label: "2 half shelves",
    description: "Past the edge or over 10 inches? Choose two.",
    receiptLabel: "Two half shelves",
    units: 2,
  },
  triple: {
    id: "triple",
    label: "3 half shelves",
    description: "About three half-shelf footprints.",
    receiptLabel: "Three half shelves",
    units: 3,
  },
  large: {
    id: "large",
    label: "4 or more half shelves",
    description: "The per-client base charge is capped, even if the load uses more space.",
    receiptLabel: "Four or more half shelves / whole kiln",
    units: null,
  },
  unknown: {
    id: "unknown",
    label: "I’m not sure",
    description: "We’ll check it at dropoff.",
    receiptLabel: "Space needs studio check",
    units: null,
  },
});

const serviceById = Object.fromEntries(
  serviceCatalog.services.map((service) => [service.id, service]),
);

export const initialState = Object.freeze({
  entryId: null,
  intentId: null,
  workId: null,
  heatId: null,
  spaceId: null,
  phase: "orient",
});

export function demoReducer(state, action) {
  switch (action.type) {
    case "select-entry": {
      if (!entryChoices[action.entryId]) throw new Error(`Unknown entry: ${action.entryId}`);
      if (action.entryId === "pickup") {
        return { entryId: "pickup", intentId: "collection", workId: null, heatId: null, spaceId: null, phase: "guidance" };
      }
      if (action.entryId === "other") {
        return { entryId: "other", intentId: null, workId: null, heatId: null, spaceId: null, phase: "question" };
      }
      return { entryId: "dropoff", intentId: "dropoff", workId: null, heatId: null, spaceId: null, phase: "heat" };
    }
    case "select-question": {
      if (!questionChoices[action.questionId]) throw new Error(`Unknown question: ${action.questionId}`);
      if (action.questionId === "readiness") {
        return { entryId: "other", intentId: "readiness", workId: null, heatId: null, spaceId: null, phase: "guidance" };
      }
      if (action.questionId === "unusual") {
        return { entryId: "other", intentId: "unusual", workId: "large", heatId: "unknown", spaceId: null, phase: "guidance" };
      }
      return { entryId: "other", intentId: "question", workId: "unknown", heatId: "unknown", spaceId: null, phase: "guidance" };
    }
    case "select-intent": {
      if (!intents[action.intentId]) throw new Error(`Unknown intent: ${action.intentId}`);
      if (action.intentId === "pickup") {
        return { entryId: "other", intentId: "pickup", workId: null, heatId: null, spaceId: null, phase: "guidance" };
      }
      if (action.intentId === "unusual") {
        return { entryId: "other", intentId: "unusual", workId: "large", heatId: "unknown", spaceId: null, phase: "guidance" };
      }
      if (action.intentId === "collection") {
        return { entryId: "pickup", intentId: "collection", workId: null, heatId: null, spaceId: null, phase: "guidance" };
      }
      return { entryId: action.intentId === "dropoff" ? "dropoff" : "other", intentId: action.intentId, workId: null, heatId: null, spaceId: null, phase: "heat" };
    }
    case "select-heat": {
      if (!heatChoices[action.heatId]) throw new Error(`Unknown firing range: ${action.heatId}`);
      return { ...state, workId: null, heatId: action.heatId, spaceId: null, phase: "space" };
    }
    case "select-space": {
      if (!spaceChoices[action.spaceId]) throw new Error(`Unknown space estimate: ${action.spaceId}`);
      return { ...state, workId: null, spaceId: action.spaceId, phase: "guidance" };
    }
    case "confirm-next-step":
      if (state.phase !== "guidance") throw new Error("A plan can only be prepared from guidance.");
      return { ...state, phase: "receipt" };
    case "change-answers":
      if (state.phase !== "receipt") return state;
      return { ...state, phase: "guidance" };
    case "back":
      if (state.phase === "question") return { ...initialState };
      if (state.phase === "heat") {
        if (state.entryId === "other") {
          return { entryId: "other", intentId: null, workId: null, heatId: null, spaceId: null, phase: "question" };
        }
        return { ...initialState };
      }
      if (state.phase === "space") return { ...state, spaceId: null, phase: "heat" };
      if (state.phase === "guidance" && state.intentId === "collection") {
        return { ...initialState };
      }
      if (state.phase === "guidance" && ["pickup", "readiness", "unusual", "question"].includes(state.intentId)) {
        return { entryId: "other", intentId: null, workId: null, heatId: null, spaceId: null, phase: "question" };
      }
      if (state.phase === "guidance") return { ...state, phase: "space" };
      return state;
    case "reset":
      return { ...initialState };
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

function needsHumanReview(state) {
  return (
    state.intentId === "unusual" ||
    state.intentId === "question" ||
    state.heatId === "unknown" ||
    state.spaceId === "unknown"
  );
}

export function getJourneyPresentation(state) {
  if (!state.entryId) {
    return {
      mode: "firing",
      routeIds: ["orient"],
      focusStageId: "orient",
      routeLabel: "Select a task to see the steps",
      supportActive: false,
    };
  }

  if (state.phase === "question") {
    return {
      mode: "support",
      routeIds: ["choose"],
      focusStageId: "choose",
      routeLabel: "Choose a topic, read the answer, then contact us only if you still need to.",
      supportActive: true,
    };
  }

  const intent = intents[state.intentId];
  const supportActive = needsHumanReview(state);
  let focusStageId = "choose";

  if (state.intentId === "collection") focusStageId = "ready";
  else if (["pickup", "readiness"].includes(state.intentId)) focusStageId = "choose";
  else if (supportActive) focusStageId = "choose";
  else if (state.phase === "heat" || state.phase === "space") focusStageId = "choose";
  else if (state.phase === "guidance") focusStageId = "kiln";
  else if (state.phase === "receipt") focusStageId = "dropoff";

  return {
    mode: state.entryId === "other" ? "support" : state.entryId === "pickup" ? "pickup" : "firing",
    routeIds: supportActive ? ["choose"] : intent.route.filter((id) => id !== "support"),
    focusStageId,
    routeLabel: state.entryId === "other"
      ? "Read the quick answer, then decide whether the studio needs a note."
      : `Standard path for ${intent.shortLabel}`,
    supportActive,
  };
}

export function getScene(state) {
  if (["pickup", "readiness"].includes(state.intentId)) {
    return {
      src: pickupShelf,
      alt: "Ceramic work packed upright in padded crates for safe transport",
      caption: "Pack the work so it can travel without flexing, denting, or breaking.",
    };
  }
  if (state.intentId === "collection") {
    return {
      src: pickupShelf,
      alt: "Finished ceramic work packed upright in padded crates for pickup",
      caption: "The ready note means your work has cooled and is set aside for pickup.",
    };
  }
  if (state.entryId === "other") {
    return {
      src: studioTable,
      alt: "Ceramic work and studio notes arranged on a pottery worktable",
      caption: "Start with the quick answer. Send a note only if you still need the studio.",
    };
  }
  if (state.phase === "guidance" || state.phase === "receipt") {
    return {
      src: kilnCare,
      alt: "Ceramic work prepared beside an open kiln in a warm home pottery studio",
      caption: "We confirm shelf fit and placement when the work arrives.",
    };
  }
  return {
    src: studioTable,
    alt: "Ceramic work, glaze tests, and measuring tools arranged on a home-studio table",
    caption: "Clay and glaze information keeps each piece with the right firing.",
  };
}

const artistInputLabels = Object.freeze({
  "material notes": "Clay and glaze labels or notes",
  "surface notes": "Glazed or bare surfaces",
  "piece size": "Tallest and widest measurements",
  "photos for unusual forms": "Notes about unusual shapes",
  "handling notes": "Anything fragile or needing special care",
  "timing need if any": "Timing needs, if any",
  "batch size": "How many pieces",
  "shelf or height needs": "Shelf space or height needed",
  deadline: "Any deadline",
  "special handling notes": "Anything needing special care",
});

function humanizeArtistInput(input) {
  return artistInputLabels[input] ?? input;
}

function getSpaceEstimate(heat, space) {
  if (heat.id === "custom") {
    return { priceLabel: "Price", price: "No estimate yet", priceNote: "Custom firing needs a separate quote from the studio." };
  }
  if (heat.id === "unknown" || space.id === "unknown") {
    return { priceLabel: "Price", price: "No estimate yet", priceNote: "We need the firing and shelf space before making a useful estimate." };
  }
  const service = serviceById[heat.serviceId];
  const maximum = service.priceCapUsd;
  if (!Number.isFinite(maximum)) throw new Error("Missing numeric four-half-shelf pricing cap.");
  if (space.id === "large") {
    return { priceLabel: "Maximum estimate", price: `Up to $${maximum} — per-client base cap`, priceNote: "The base charge is capped per client. Privacy and fulfilled rush requests are additional; the studio confirms fit." };
  }
  const notes = {
    half: "Based on one half-shelf footprint viewed from above, with every piece 10 inches tall or less.",
    double: "A load that crosses one semicircle from above or includes anything over 10 inches tall uses at least two half-shelf units.",
    triple: "Based on three half-shelf footprints viewed from above.",
  };
  return { priceLabel: "Estimated price", price: `$${service.halfShelfPriceUsd * space.units} estimated`, priceNote: `${notes[space.id]} This base estimate excludes add-ons. We confirm the actual fit at dropoff.` };
}

export function getSpaceChoicePriceHint(heatId, spaceId) {
  if (!heatId) return null;
  const heat = heatChoices[heatId];
  if (!heat || heat.id === "unknown" || spaceId === "unknown") return { kind: "unknown", text: "Studio checks it at dropoff" };
  if (heat.id === "custom") return { kind: "unknown", text: "Studio quote required" };
  const service = serviceById[heat.serviceId];
  if (spaceId === "large") return { kind: "maximum", text: `Heads-up · up to $${service.priceCapUsd}` };
  return { kind: "estimate", text: `Heads-up · about $${service.halfShelfPriceUsd * spaceChoices[spaceId].units}` };
}

export const estimateBillingNote = "This is an estimate. You pay after the firing for the space your work used. If something goes wrong because of us, there’s no firing charge. If the issue comes from the clay, glaze, or construction, the firing is still charged.";

export function getGuidance(state) {
  if (!state.intentId || !["guidance", "receipt"].includes(state.phase)) return null;
  if (state.intentId === "dropoff" && !state.spaceId) return null;

  if (state.intentId === "collection") {
    return {
      variant: "pickup",
      routeName: "Pickup",
      title: "Your work is waiting for you.",
      priceLabel: "Price",
      price: "No new estimate",
      priceNote: "Not shown for pickup.",
      highlightTitle: "Your ready note means",
      highlight: "Fired, cooled, and set aside",
      highlightNote: "The kiln work is finished. Your pieces are through the studio path and waiting for you.",
      detailTitle: "Use the details in that note",
      detail: "That ready email is your go-ahead. It has the private address, access, and pickup timing. Need help with the handoff? Reply before traveling. The instructed outdoor pickup rack is available 24/7.",
      nextAction: "If the note is no longer handy, ask us to send the pickup details again.",
      inputs: ["Name or nickname used at dropoff", "Ticket reference, if handy", "Anything that helps identify the work"],
      ctaLabel: "Send the details again",
      exitLabel: "I have what I need",
      exitHref: "../",
      staffBoundary: "We’ll send a pickup reminder now and let the studio know if the private access details need to be resent.",
      showInputList: false,
      selfServeNote: "Standard pickup does not require a conversation; follow the ready note and you’re good to go.",
    };
  }

  if (["pickup", "readiness"].includes(state.intentId)) {
    return {
      variant: "support",
      routeName: "Ready check",
      title: "If it can travel safely, bring it.",
      priceLabel: "Price",
      price: "No new estimate",
      priceNote: "Not shown in the help path.",
      answerEyebrow: "Quick answer",
      answerTitle: "Use the trip as the test.",
      answer: "Pack it so it cannot flex, dent, touch another piece, or hit the sides of the container. If it can make that trip, bring it in; we can hold it until it is actually ready for the kiln.",
      followupTitle: "Still unsure about a fragile edge or attachment?",
      followup: "Send the studio a short note. You only need to decide whether the work can travel safely.",
      nextAction: "Tell us what feels uncertain and we’ll help with the handoff.",
      inputs: ["Tallest and widest measurements", "How you plan to pad and carry it", "Anything thin, attached, or fragile"],
      ctaLabel: "Ask the studio",
      exitLabel: "That answers it",
      exitTarget: "questions",
    };
  }

  if (state.intentId === "unusual") {
    return {
      variant: "support",
      routeName: "Fit check",
      title: "A few details will tell us what fits.",
      priceLabel: "Maximum estimate",
      price: "No estimate yet",
      priceNote: "Not shown in the help path.",
      answerEyebrow: "What matters",
      answerTitle: "Tell us what makes it unusual.",
      answer: "The useful details are the firing range, tallest and widest measurements, and anything unusual about the surface, shape, attachments, or handling.",
      followupTitle: "We’ll work out fit and price from there.",
      followup: "A rough description is enough to start. The studio will reply before treating it like a standard dropoff.",
      nextAction: "Send those details and we’ll help plan a safe firing.",
      inputs: ["Firing range, if known", "Tallest and widest measurements", "Notes about the surface, shape, or handling"],
      ctaLabel: "Ask the studio",
      exitLabel: "I know what to send",
      exitTarget: "questions",
    };
  }

  if (needsHumanReview(state)) {
    const space = state.spaceId ? spaceChoices[state.spaceId] : null;
    return {
      variant: state.entryId === "other" ? "support" : "estimate",
      routeName: "Fit check",
      title: state.entryId === "other" ? "Start with the label you have." : "Let’s look at it together.",
      priceLabel: "Price",
      price: "No estimate yet",
      priceNote: state.entryId === "other" ? "Not shown in the help path." : "We won’t guess at the material, firing range, or price.",
      answerEyebrow: "Best starting point",
      answerTitle: "Look for Low, Mid, or High on the clay or glaze label.",
      answer: "If the label is unclear, send us the wording you can find. We would rather check it than guess at a firing range.",
      followupTitle: "Missing the label? Tell us what you know.",
      followup: "Tell us what you know about the material and whether it has been fired before. Staff can help choose the next safe step.",
      riskTitle: "Show us what you know.",
      risk: "Share the firing range if you know it, the tallest and widest measurements, and anything unusual about the surface or shape.",
      nextAction: "Send what you know and we’ll help choose a safe next step.",
      inputs: ["Firing range, if known", "Tallest and widest measurements", "Notes about the surface, shape, or handling"],
      ctaLabel: state.entryId === "other" ? "Ask the studio" : "Continue",
      exitLabel: state.entryId === "other" ? "I know where to start" : null,
      exitTarget: state.entryId === "other" ? "questions" : null,
      spaceLabel: space?.receiptLabel ?? null,
      billingPolicy: state.intentId === "dropoff" ? estimateBillingNote : null,
    };
  }

  const heat = heatChoices[state.heatId];
  const service = serviceById[heat.serviceId];
  const space = spaceChoices[state.spaceId];
  const estimate = getSpaceEstimate(heat, space);
  const riskByHeat = {
    low: "Make sure the work can be packed and travel safely. For glazed work, wipe glaze off the bottom and foot wherever the piece touches the kiln shelf; leave that contact surface as bare clay. If it makes the trip safely, we can hold it until it is ready to fire.",
    mid: "Make sure the work can be packed and travel safely. For glazed work, wipe glaze off the bottom and foot wherever the piece touches the kiln shelf; leave that contact surface as bare clay. If it makes the trip safely, we can hold it until it is ready to fire.",
    high: "Make sure the work can be packed and travel safely. For glazed work, wipe glaze off the bottom and foot wherever the piece touches the kiln shelf; leave that contact surface as bare clay. If it makes the trip safely, we can hold it until it is ready to fire.",
    custom: "Tell us about the ramp, height, batch size, deadline, or private-kiln need so we can plan it before quoting.",
  };
  const extraInputBySpace = {
    half: "Any piece close to 10 inches tall",
    double: "Anything crossing one half shelf or over 10 inches tall",
    triple: "Anything especially wide, tall, or stackable",
    large: "Anything especially wide, tall, or stackable",
    unknown: "Anything especially wide, tall, or stackable",
  };

  const titleByHeat = {
    low: "Your low-fire dropoff.",
    mid: "Your mid-fire dropoff.",
    high: "Your cone 10 electric oxidation dropoff.",
    custom: "Let’s plan your custom firing.",
  };

  return {
    variant: "estimate",
    routeName: heat.id === "custom" ? "Custom firing" : heat.id === "low" ? "Low fire" : heat.id === "high" ? "High fire" : "Mid fire",
    title: titleByHeat[heat.id],
    priceLabel: estimate.priceLabel,
    price: estimate.price,
    priceNote: heat.id === "high"
      ? `${estimate.priceNote} Shared cone 10 runs require scheduling confirmation.`
      : estimate.priceNote,
    riskTitle: heat.id === "custom" ? "Tell us what makes this firing different." : "Before you bring it in",
    risk: riskByHeat[heat.id],
    nextAction: heat.id === "custom"
      ? "Finish this request and we’ll follow up about fit, access, and timing."
      : "Send this plan for a ticket. The studio confirms private directions separately; wait for those details before traveling.",
    inputs: [...service.artistInputs.map(humanizeArtistInput), extraInputBySpace[space.id]],
    ctaLabel: heat.id === "custom" ? "Continue" : "Continue to dropoff",
    spaceLabel: space.receiptLabel,
    billingPolicy: estimateBillingNote,
    billingTitle: "Estimate now. Pay after firing.",
    showInputList: heat.id === "custom",
    selfServeNote: heat.id === "custom" || heat.id === "high"
      ? null
      : "If you’re shy, that’s fine — we’re shy too. Standard dropoff and pickup do not require a conversation; follow the dropoff instructions or ready email and you’re good to go.",
    staffBoundary: heat.id === "high" ? "The studio confirms scheduling for shared cone 10 runs before firing. Private firing is $180 even for partial loads. Rush is $20 only if fulfilled." : heat.id === "custom"
      ? "We’ll confirm fit, studio access, loading, and timing before anything is scheduled."
      : "We’ll confirm the shelf fit when the work arrives.",
  };
}

export function getReceipt(state) {
  const guidance = getGuidance(state);
  if (!guidance || state.phase !== "receipt") return null;

  const intent = intents[state.intentId];
  const work = state.workId ? supportWorkLabels[state.workId] : null;
  const heat = state.heatId ? heatChoices[state.heatId] : null;
  const isDropoff = state.intentId === "dropoff";
  const receiptId = isDropoff
    ? `MF-DROPOFF-${(state.heatId || "UNKNOWN").toUpperCase()}`
    : `MF-${state.intentId.toUpperCase()}-${(state.workId || "STATUS").toUpperCase()}-${(state.heatId || "READY").toUpperCase()}`;

  return {
    modelVersion: 3,
    intentId: state.intentId,
    workId: state.workId,
    heatId: state.heatId,
    spaceId: state.spaceId,
    id: receiptId,
    intent: intent.label,
    work: isDropoff
      ? null
      : work ?? (state.intentId === "collection" ? "Finished work pickup" : "Unfired work readiness check"),
    heat: heat?.label ?? "Not applicable",
    space: isDropoff ? guidance.spaceLabel : null,
    routeName: guidance.routeName,
    priceLabel: guidance.priceLabel,
    price: guidance.price,
    inputs: guidance.inputs,
    nextAction: guidance.nextAction,
    staffBoundary: guidance.staffBoundary ?? "We’ll confirm fit, studio access, loading, and timing before anything is scheduled.",
    estimateNote: isDropoff ? estimateBillingNote : null,
    variant: guidance.variant,
    showInputList: guidance.showInputList,
    selfServeNote: guidance.selfServeNote ?? null,
    lifecycleNote: isDropoff
      ? "After you finish, your ticket arrives by email. The studio confirms the private address and gate instructions separately; wait for those details before traveling. When the work is ready, we’ll email you to pick it up."
      : state.intentId === "collection"
        ? "We’ll email the pickup reminder now and let the studio know if you need the private access details again."
        : "We’ll email this question to the studio and send you the same summary.",
  };
}

export function formatReceipt(receipt, ticketId = null) {
  const lines = [
    `Monsoon Fire firing plan${ticketId ? ` · reference ${ticketId}` : ""}`,
    `Service: ${receipt.intent}`,
  ];
  if (receipt.work) lines.push(`Your work: ${receipt.work}`);
  if (receipt.heat !== "Not applicable") lines.push(`Firing range: ${receipt.heat}`);
  if (receipt.space) lines.push(`Estimated space: ${receipt.space}`);
  if (receipt.routeName === "Fit check") lines.push(`Studio review: ${receipt.routeName}`);
  if (receipt.intentId === "dropoff") lines.push(`${receipt.priceLabel}: ${receipt.price}`);
  if (receipt.showInputList !== false && receipt.inputs.length) {
    lines.push(`Details: ${receipt.inputs.join(", ")}`);
  }
  lines.push(`Next: ${receipt.nextAction}`, receipt.staffBoundary);
  if (receipt.lifecycleNote) lines.push(receipt.lifecycleNote);
  if (receipt.estimateNote) lines.push(receipt.estimateNote);
  return lines.join("\n");
}
