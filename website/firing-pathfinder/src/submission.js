const submissionEndpoint =
  "https://us-central1-monsoonfire-portal.cloudfunctions.net/firingPathfinderRequest";

export class FiringSubmissionError extends Error {
  constructor(message, { code = "SUBMISSION_FAILED", status = 0, retryAfter = null } = {}) {
    super(message);
    this.name = "FiringSubmissionError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function createClientRequestId(now = new Date()) {
  const randomId = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const issueDate = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
  ].join("");
  return `fp_${issueDate}_${randomId.slice(0, 55)}`;
}

export function buildFiringSubmissionPayload({
  clientRequestId,
  name,
  email,
  note,
  consentToContact,
  deliveryMode,
  website,
  receipt,
  legalAcceptance,
  addOnRequests,
}) {
  return {
    clientRequestId,
    name: name.trim(),
    email: email.trim(),
    note: note.trim(),
    consentToContact,
    deliveryMode,
    website,
    legalAcceptance,
    ...(receipt.intentId === "dropoff" && addOnRequests ? { addOnRequests } : {}),
    pagePath: "/firing-services/pathfinder/",
    selection: {
      modelVersion: receipt.modelVersion,
      intentId: receipt.intentId,
      workId: receipt.workId,
      heatId: receipt.heatId,
      spaceId: receipt.spaceId,
    },
  };
}

export async function submitFiringTicket(input, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new FiringSubmissionError("Sending is unavailable in this browser.");
  }

  const payload = buildFiringSubmissionPayload(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(submissionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": input.clientRequestId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responsePayload = await response.json().catch(() => null);
    if (!response.ok || !responsePayload?.ok) {
      throw new FiringSubmissionError(
        responsePayload?.message || "We couldn’t send the ticket. Your answers are still here.",
        {
          code: responsePayload?.code,
          status: response.status,
          retryAfter: response.headers?.get?.("Retry-After") ?? null,
        },
      );
    }
    return responsePayload.data;
  } catch (error) {
    if (error instanceof FiringSubmissionError) throw error;
    if (error?.name === "AbortError") {
      throw new FiringSubmissionError("Sending took too long. Please try again.", { code: "TIMEOUT" });
    }
    throw new FiringSubmissionError("We couldn’t send the ticket. Your answers are still here.");
  } finally {
    clearTimeout(timeout);
  }
}
