import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.jsx";

const sharedBillingPolicy =
  "This is an estimate. You pay after the firing for the space your work used. If something goes wrong because of us, there’s no firing charge. If the issue comes from the clay, glaze, or construction, the firing is still charged.";

const standardSelfServeNote =
  "If you’re shy, that’s fine — we’re shy too. Standard dropoff and pickup do not require a conversation; follow the dropoff instructions or ready email and you’re good to go.";

const dropoffLifecycleNote =
  "After you finish, your ticket arrives by email. The studio confirms the private address and gate instructions separately; wait for those details before traveling. When the work is ready, we’ll email you to pick it up.";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  for (const setting of ["textSize", "contrast", "motion", "focus"]) {
    delete document.documentElement.dataset[setting];
  }
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
});

async function chooseDropoff(user, heat = "Mid fire", space = "1 half shelf") {
  await user.click(screen.getByRole("radio", { name: /drop off work/i }));
  await user.click(screen.getByRole("button", { name: /^continue$/i }));
  await user.click(screen.getByRole("radio", { name: new RegExp(heat, "i") }));
  await user.click(screen.getByRole("button", { name: /next: estimate kiln space/i }));
  await user.click(screen.getByRole("radio", { name: new RegExp(space, "i") }));
  await user.click(screen.getByRole("button", { name: /see my estimate/i }));
}

async function prepareDropoffTicket(user, heat, space) {
  await chooseDropoff(user, heat, space);
  await user.click(screen.getByRole("button", { name: /continue to dropoff/i }));
}

async function chooseOther(user, question) {
  await user.click(screen.getByRole("radio", { name: /ask something else/i }));
  await user.click(screen.getByRole("button", { name: /^continue$/i }));
  await user.click(screen.getByRole("radio", { name: question }));
  await user.click(screen.getByRole("button", { name: /^continue$/i }));
}

async function acceptLegal(user) {
  await user.click(screen.getByRole("checkbox", { name: /agree to the terms of service/i }));
  await user.click(screen.getByRole("checkbox", { name: /acknowledge the current studio policies/i }));
}

function mockSuccess({
  ticketId = "MF-0711-BXUM",
  emailQueued = false,
  supportRequestId = null,
} = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      ok: true,
      data: { ticketId, supportRequestId, emailQueued, duplicate: false },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makePrintLayoutFit() {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function getClientHeight() {
    return this.classList?.contains("print-ticket-sheet") ? 1000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function getScrollHeight() {
    return this.classList?.contains("print-ticket-sheet") ? 900 : 0;
  });
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback(0);
    return 1;
  });
}

describe("interactive kiln pathfinder", () => {
  it("opens with exactly the three task-first choices and no Kilnfire handoff", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Plan your firing." })).toBeVisible();
    expect(screen.getByText(
      "This optional planner estimates your firing and sends a ticket to keep your work and details together. Standard handoffs use the outdoor rack 24/7 once you have access instructions. First time? Email the studio or start below.",
    )).toBeVisible();
    expect(screen.getByRole("heading", { name: /what brings you by the studio/i })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /drop off work/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /pick up finished work/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /ask something else/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /kilnfire/i })).not.toBeInTheDocument();
  });

  it("provides a keyboard-ready skip link and persistent display options", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("mf:firingCareA11y", JSON.stringify({
      textSize: "normal",
      contrast: "normal",
      motion: "full",
      focus: "high",
    }));
    render(<App />);

    expect(screen.getByRole("link", { name: "Skip to planner" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");

    const trigger = screen.getByRole("button", { name: /open display options/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Display options" });
    const largerText = within(panel).getByRole("button", { name: "Larger text" });
    expect(largerText).toHaveFocus();
    expect(JSON.parse(window.localStorage.getItem("mf:firingCareA11y"))).toEqual({
      textSize: "normal",
      contrast: "normal",
      motion: "full",
    });

    await user.click(largerText);
    await user.click(within(panel).getByRole("button", { name: "High contrast" }));
    await user.click(within(panel).getByRole("button", { name: "Reduce motion" }));
    expect(document.documentElement).toHaveAttribute("data-text-size", "large");
    expect(document.documentElement).toHaveAttribute("data-contrast", "high");
    expect(document.documentElement).toHaveAttribute("data-motion", "reduced");
    expect(JSON.parse(window.localStorage.getItem("mf:firingCareA11y"))).toEqual({
      textSize: "large",
      contrast: "high",
      motion: "reduced",
    });

    await user.click(within(panel).getByRole("button", { name: "Reset display options" }));
    expect(document.documentElement).toHaveAttribute("data-text-size", "normal");
    expect(document.documentElement).toHaveAttribute("data-contrast", "normal");
    expect(document.documentElement).toHaveAttribute("data-motion", "full");
    expect(JSON.parse(window.localStorage.getItem("mf:firingCareA11y"))).toEqual({
      textSize: "normal",
      contrast: "normal",
      motion: "full",
    });

    await user.click(within(panel).getByRole("button", { name: "Close display options" }));
    expect(screen.queryByRole("region", { name: "Display options" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Display options" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the page heading available and restores focus when Back returns to the start", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("radio", { name: /drop off work/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByRole("heading", { level: 1, name: "Plan your firing." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /which firing comes next/i })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByRole("heading", { name: /what brings you by the studio/i })).toHaveFocus();
  });

  it("restores focus to the opening choice heading after Start over", async () => {
    const user = userEvent.setup();
    render(<App />);
    await prepareDropoffTicket(user);

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByRole("heading", { name: /what brings you by the studio/i })).toHaveFocus();
  });

  it("goes from firing range directly to visual kiln space with no clay-body intake", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("radio", { name: /drop off work/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByRole("heading", { name: /which firing comes next/i })).toBeVisible();

    await user.click(screen.getByRole("radio", { name: /mid fire/i }));
    await user.click(screen.getByRole("button", { name: /next: estimate kiln space/i }));
    expect(screen.getByRole("heading", { name: /how much kiln space will your work need/i })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: /^1 half shelf/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /^2 half shelves/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /^3 half shelves/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /^4 or more half shelves/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /^i’m not sure/i })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /clay-body check/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^earthenware/i })).not.toBeInTheDocument();
  });

  it("opens each kiln-space example without changing the plain radio estimate", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.dblClick(screen.getByRole("radio", { name: /drop off work/i }));
    await user.dblClick(screen.getByRole("radio", { name: /mid fire/i }));

    const guide = screen.getByRole("region", { name: /start with one half shelf/i });
    expect(within(guide).getByText("One half shelf is about this much.")).toBeVisible();
    expect(within(guide).getByText("This is a heads-up, not a bill.")).toBeVisible();
    expect(within(guide).getByText(/put your work together in the half-shelf shape/i)).toBeVisible();
    expect(within(guide).getAllByRole("img")).toHaveLength(3);
    expect(within(guide).getByRole("img", { name: /artist arranging a full load/i })).toBeVisible();
    expect(within(guide).getByRole("img", { name: /sizing board with a tall vase/i })).toBeVisible();
    expect(within(guide).getByRole("img", { name: /open kiln showing a half shelf/i })).toBeVisible();
    expect(within(guide).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(guide).getAllByRole("button")).toHaveLength(3);
    expect(within(guide).queryByRole("checkbox")).not.toBeInTheDocument();

    const firstExample = within(guide).getByRole("button", { name: /open example: start with one half shelf/i });
    await user.click(firstExample);
    const dialog = screen.getByRole("dialog", { name: /start with one half shelf/i });
    expect(within(dialog).getByRole("img", { name: /artist arranging a full load/i })).toBeVisible();
    expect(within(dialog).getByText(/choose 1 half shelf as your closest guess/i)).toBeVisible();
    expect(within(dialog).getByText("Closest guess: 1 half shelf")).toBeVisible();
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio").every((radio) => !radio.checked)).toBe(true);
    expect(within(dialog).getByRole("button", { name: /close/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(firstExample).toHaveFocus();

    const expectedChoices = [
      [/^1 half shelf/i, "half"],
      [/^2 half shelves/i, "double"],
      [/^3 half shelves/i, "triple"],
      [/^4 or more half shelves/i, "large"],
      [/^i’m not sure/i, "unknown"],
    ];
    for (const [name, choiceId] of expectedChoices) {
      const card = screen.getByRole("radio", { name }).closest("label");
      expect(card).toHaveAttribute("data-choice-id", choiceId);
      expect(card.querySelector(".space-choice-visual")).not.toBeInTheDocument();
    }

    const rules = screen.getByRole("region", { name: /how shelf space is estimated/i });
    expect(within(rules).getByText("Stackable bisque")).toBeVisible();
    expect(within(rules).getByText(/glazed surfaces do not/i)).toBeVisible();
    expect(within(rules).getByText("Small glaze runs")).toBeVisible();
    expect(within(rules).getByText(/Advancer shelves help with small runs/i)).toBeVisible();

    expect(within(guide).getByText("Check both width and height")).toBeVisible();
    expect(within(guide).getByText(/Over the curved edge or 10 inches tall/i)).toBeInTheDocument();
    expect(within(guide).getByText("Tall work uses two shelf levels")).toBeVisible();
    expect(within(guide).getByText(/narrow and still use the shelf above/i)).toBeInTheDocument();
  });

  it.each([
    [/^Low fire/i, "Heads-up · about $40", "estimate"],
    [/^Mid fire/i, "Heads-up · about $70", "estimate"],
    [/^Special \/ custom firing/i, "Studio quote required", "unknown"],
    [/^I’m not sure/i, "Studio checks it at dropoff", "unknown"],
  ])("shows the selected range price boundary on the double-space card", async (heat, hint, kind) => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("radio", { name: /drop off work/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("radio", { name: heat }));
    await user.click(screen.getByRole("button", { name: /next: estimate kiln space/i }));

    const doubleChoice = screen.getByRole("radio", { name: /^2 half shelves/i }).closest("label");
    const priceHint = within(doubleChoice).getByText(hint);
    expect(priceHint).toBeVisible();
    expect(priceHint).toHaveAttribute("data-price-kind", kind);
    if (kind === "maximum") expect(priceHint).not.toHaveTextContent(/minimum/i);
  });

  it("estimates $60 for three low-fire half shelves and explains billing in Stage 04", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseDropoff(user, "Low fire", "3 half shelves");

    expect(screen.getByRole("heading", { name: /your low-fire dropoff/i })).toBeVisible();
    expect(screen.getByText("$60 estimated")).toBeVisible();
    expect(screen.getByText(/based on three half-shelf footprints viewed from above/i)).toBeVisible();
    const billing = screen.getByRole("region", { name: /estimate now\. pay after firing/i });
    expect(within(billing).getByText(sharedBillingPolicy)).toBeVisible();
    const selfServe = screen.getByRole("region", { name: /no conversation required/i });
    expect(within(selfServe).getByText(standardSelfServeNote)).toBeVisible();
    expect(screen.queryByRole("heading", { name: /what to have handy|details that help/i })).not.toBeInTheDocument();
    expect(screen.getByText(/wipe glaze off the bottom and foot/i)).toBeVisible();
    expect(document.body).not.toHaveTextContent(/label each piece/i);
    expect(screen.queryByText(/example price/i)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/completely dry|dryness/i);
  });

  it("shows $105 for three glaze shelves and the $120 cap for four or more", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("radio", {name:/drop off work/i}));
    await user.click(screen.getByRole("button", {name:/^continue$/i}));
    await user.click(screen.getByRole("radio", {name:/^mid fire/i}));
    await user.click(screen.getByRole("button", {name:/next: estimate kiln space/i}));
    const triple=screen.getByRole("radio",{name:/^3 half shelves/i}).closest("label");
    expect(within(triple).getByText("Heads-up · about $105")).toBeVisible();
    const large=screen.getByRole("radio",{name:/^4 or more half shelves/i}).closest("label");
    expect(within(large).getByText("Heads-up · up to $120")).toBeVisible();
    await user.click(screen.getByRole("radio",{name:/^4 or more half shelves/i}));
    await user.click(screen.getByRole("button",{name:/see my estimate/i}));
    expect(screen.getByText("Up to $120 — per-client base cap")).toBeVisible();
    expect(screen.getByText(/base charge is capped per client/i)).toBeVisible();
  });

  it("builds one concise final check without a print/email delivery fork", async () => {
    const user = userEvent.setup();
    render(<App />);
    await prepareDropoffTicket(user, "Mid fire", "2 half shelves");

    expect(screen.getByRole("heading", { name: /give it a quick look/i })).toBeVisible();
    const plan = screen.getByRole("article", { name: /your firing plan/i });
    expect(within(plan).getByText("Your firing plan")).toBeVisible();
    expect(within(plan).getByText("Review your estimate")).toBeVisible();
    expect(within(plan).getByText("Mid fire")).toBeVisible();
    expect(within(plan).getByText("Two half shelves")).toBeVisible();
    expect(within(plan).getByText("$70 estimated")).toBeVisible();
    expect(within(plan).getByText(dropoffLifecycleNote)).toBeVisible();
    expect(within(plan).queryByText("Your work")).not.toBeInTheDocument();
    expect(within(plan).queryByRole("heading", { name: /details to have handy|details that help/i })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/permanent id|ticket issued|no permanent|nothing has been submitted/i);
    expect(screen.getByRole("heading", { name: /who should this firing ticket belong to/i })).toBeVisible();
    expect(screen.getByLabelText("Name or nickname")).toBeRequired();
    expect(screen.getByRole("textbox", { name: /^email/i })).toBeRequired();
    expect(screen.getByRole("checkbox", { name: /agree to the terms of service/i })).toBeRequired();
    expect(screen.getByRole("checkbox", { name: /acknowledge the current studio policies/i })).toBeRequired();
    expect(screen.getByRole("button", { name: /send my firing ticket/i })).toBeVisible();
    expect(screen.queryByRole("radio", { name: /print|email/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy plan|copy ticket/i })).not.toBeInTheDocument();
  });

  it("carries the exact shared billing policy across the final check, issued copy, and print sheet", async () => {
    const user = userEvent.setup();
    const clipboardSpy = vi.spyOn(navigator.clipboard, "writeText");
    mockSuccess({ emailQueued: true, supportRequestId: "pathfinder-abc123" });
    render(<App />);
    await prepareDropoffTicket(user, "Mid fire", "1 half shelf");

    const plan = screen.getByRole("article", { name: /your firing plan/i });
    expect(within(plan).getByText(sharedBillingPolicy)).toBeVisible();

    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /send my firing ticket/i }));
    await user.click(await screen.findByRole("button", { name: /copy ticket/i }));
    expect(clipboardSpy).toHaveBeenCalledOnce();
    expect(clipboardSpy.mock.calls[0][0]).toContain(sharedBillingPolicy);

    const printSheet = document.querySelector(".print-ticket-sheet");
    expect(printSheet).toHaveTextContent(sharedBillingPolicy);
  });

  it("submits once, emails automatically, and exposes optional print and copy utilities", async () => {
    makePrintLayoutFit();
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);
    const fetchMock = mockSuccess({ emailQueued: true, supportRequestId: "pathfinder-abc123" });
    const user = userEvent.setup();
    render(<App />);
    await prepareDropoffTicket(user);

    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    expect(screen.getByRole("textbox", { name: /^email/i })).toBeRequired();
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    await user.click(screen.getByRole("checkbox", { name: /fire tonight/i }));
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /send my firing ticket/i }));

    const successHeading = await screen.findByRole("heading", { name: /your dropoff is expected/i });
    expect(successHeading).toBeVisible();
    expect(successHeading).toHaveFocus();
    const success = document.querySelector(".submission-success");
    expect(success).toHaveTextContent("Reference MF-0711-BXUM");
    expect(success).toHaveTextContent("kiln-risk facts");
    expect(success).toHaveTextContent("transport tips");
    expect(success).toHaveTextContent("studio policies");
    expect(success).not.toHaveTextContent(/permanent|issued/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      name: "Sam Potter",
      email: "sam@example.com",
      consentToContact: true,
      addOnRequests: { private: false, rush: true, communitySharing: false },
      legalAcceptance: {
        termsAccepted: true,
        policiesAcknowledged: true,
        termsVersion: "2026-07-18",
        privacyNoticeVersion: "2026-07-18",
        studioPoliciesVersion: "2026-07-18",
      },
      deliveryMode: "email",
      selection: {
        modelVersion: 3,
        intentId: "dropoff",
        workId: null,
        heatId: "mid",
        spaceId: "half",
      },
    });
    expect(printMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^print a copy$/i }));
    expect(printMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /^copy ticket$/i })).toBeVisible();
    expect(document.querySelector(".print-ticket-sheet")).toHaveTextContent("MF-0711-BXUM");
    expect(document.querySelector(".print-ticket-sheet")).toHaveTextContent("Studio + artist email");
  });

  it("keeps all three kiln-space examples mounted through repeated Back and Next cycles", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("radio", { name: /drop off work/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("radio", { name: /^low fire/i }));
    await user.click(screen.getByRole("button", { name: /next: estimate kiln space/i }));

    const expectedSources = ["kiln-space-fit-test", "kiln-space-sizing-board", "kiln-space-kiln-cutaway"];
    for (let cycle = 0; cycle < 6; cycle += 1) {
      const guide = screen.getByRole("region", { name: /start with one half shelf/i });
      const images = guide.querySelectorAll("img");
      expect(images).toHaveLength(3);
      expectedSources.forEach((source, index) => expect(images[index].getAttribute("src")).toContain(source));
      await user.click(screen.getByRole("button", { name: /^back$/i }));
      expect(screen.getByRole("heading", { name: /which firing comes next/i })).toBeVisible();
      await user.click(screen.getByRole("button", { name: /next: estimate kiln space/i }));
    }
  });

  it("does not open print until the artist explicitly asks for the optional copy", async () => {
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);
    const fetchMock = mockSuccess({ emailQueued: true, supportRequestId: "pathfinder-abc123" });
    const user = userEvent.setup();
    render(<App />);
    await prepareDropoffTicket(user);

    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /send my firing ticket/i }));

    expect(await screen.findByRole("heading", { name: /your dropoff is expected/i })).toBeVisible();
    expect(document.querySelector(".submission-success")).toHaveTextContent("Reference MF-0711-BXUM");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      deliveryMode: "email",
      email: "sam@example.com",
      consentToContact: true,
      selection: { modelVersion: 3, spaceId: "half" },
    });
    expect(printMock).not.toHaveBeenCalled();
  });

  it("does not print or lose the prepared plan when saving fails", async () => {
    makePrintLayoutFit();
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ ok: false, message: "We couldn’t save your dropoff plan. Your answers are still here." }),
    })));
    const user = userEvent.setup();
    render(<App />);
    await prepareDropoffTicket(user);
    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /send my firing ticket/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t save your dropoff plan/i);
    expect(screen.getByLabelText("Name or nickname")).toHaveValue("Sam Potter");
    expect(screen.getByRole("button", { name: /send my firing ticket/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /copy ticket/i })).not.toBeInTheDocument();
    expect(printMock).not.toHaveBeenCalled();
  });

  it("gives an unsure artist a quick answer without estimator formatting", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseOther(user, /not sure what firing i need/i);

    expect(screen.getByRole("heading", { name: /look for low, mid, or high/i })).toBeVisible();
    expect(screen.getByText("Firing range, if known")).toBeVisible();
    expect(screen.queryByText("No estimate yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask the studio/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /i know where to start/i })).toBeVisible();
    expect(screen.queryByText(/photos?/i)).not.toBeInTheDocument();
  });

  it("keeps unusual-work help out of the price estimator", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseOther(user, /i have something unusual/i);

    expect(screen.getByRole("heading", { name: /tell us what makes it unusual/i })).toBeVisible();
    expect(screen.getByText(/we’ll work out fit and price from there/i)).toBeVisible();
    expect(screen.queryByText("Up to $65 — whole kiln")).not.toBeInTheDocument();
    expect(screen.queryByText(/maximum estimate/i)).not.toBeInTheDocument();
  });

  it("sends non-dropoff questions as version-3 email requests", async () => {
    const fetchMock = mockSuccess({ emailQueued: true, supportRequestId: "pathfinder-abc123" });
    const user = userEvent.setup();
    render(<App />);
    await chooseOther(user, /i have something unusual/i);
    await user.click(screen.getByRole("button", { name: /ask the studio/i }));

    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    await user.type(screen.getByLabelText(/What should the studio know/i), "Tall handle");
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /^send my question$/i }));

    expect(await screen.findByRole("heading", { name: /the studio has it/i })).toBeVisible();
    expect(document.querySelector(".submission-success")).toHaveTextContent("Reference MF-0711-BXUM");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      deliveryMode: "email",
      selection: {
        modelVersion: 3,
        intentId: "unusual",
        workId: "large",
        heatId: "unknown",
        spaceId: null,
      },
    });
  });

  it("treats a finished-work pickup as ready and makes resend optional", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.dblClick(screen.getByRole("radio", { name: /pick up finished work/i }));
    expect(screen.getByRole("heading", { name: /your work is waiting for you/i })).toBeVisible();
    expect(screen.getByText(/fired, cooled, and set aside/i)).toBeVisible();
    expect(screen.getByText(/private address, access, and pickup timing/i)).toBeVisible();
    expect(screen.getByText(/need help with the handoff.*rack is available 24\/7/i)).toBeVisible();
    expect(screen.queryByText(/no new estimate|live firing or pickup status|wait for a ready confirmation/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send the details again/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /i have what i need/i })).toHaveAttribute("href", "../");
  });

  it("opens the FAQ chooser directly from the retired support deep link", () => {
    window.history.replaceState({}, "", `${window.location.pathname}#faq`);
    render(<App />);

    expect(screen.getByRole("heading", { name: /what would you like a quick answer on/i })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText("Need a different pickup time?")).toBeVisible();
    expect(screen.getByText(/outdoor pickup rack is available 24\/7/i)).toBeVisible();
    expect(screen.getByText("Something changed after you sent your ticket?")).toBeVisible();
    expect(screen.getByText(/reply to the ticket email.*what can still be adjusted/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  it("sends the pickup reminder only after the artist asks for it", async () => {
    const fetchMock = mockSuccess({ emailQueued: true, supportRequestId: "pathfinder-pickup" });
    const user = userEvent.setup();
    render(<App />);

    await user.dblClick(screen.getByRole("radio", { name: /pick up finished work/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /send the details again/i }));
    expect(screen.getByRole("heading", { name: /where should we send the pickup reminder/i })).toBeVisible();
    expect(screen.queryByText(/no new estimate|maximum estimate/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    await user.type(screen.getByLabelText(/helps identify the work/i), "Three blue bowls");
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /send pickup details/i }));

    expect(await screen.findByRole("heading", { name: /check your inbox/i })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      deliveryMode: "email",
      selection: {
        modelVersion: 3,
        intentId: "collection",
        workId: null,
        heatId: null,
        spaceId: null,
      },
    });
  });

  it("shows access answers and a direct homepage FAQ link without submitting a form", () => {
    window.history.replaceState({}, "", `${window.location.pathname}#faq`);
    render(<App />);
    expect(screen.getByText("First visit, or waiting for directions?")).toBeVisible();
    expect(screen.getByText(/automatic ticket email records your request/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Read all quick answers" })).toHaveAttribute("href", "/#quick-answers");
    expect(screen.getByText("Do I need an account or ticket?")).toBeVisible();
  });

  it("uses safe travel as the readiness rule and tells artists the studio can hold the work", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.dblClick(screen.getByRole("radio", { name: /ask something else/i }));
    await user.dblClick(screen.getByRole("radio", { name: /unfired work ready to bring in/i }));
    expect(screen.getByRole("heading", { name: /if it can travel safely, bring it/i })).toBeVisible();
    expect(screen.getByText(/cannot flex, dent, touch another piece, or hit the sides/i)).toBeVisible();
    expect(screen.getByText(/we can hold it until it is actually ready for the kiln/i)).toBeVisible();
    expect(document.body).not.toHaveTextContent(/completely dry|dryness/i);
  });

  it("returns That answers it to a clean FAQ topic start without leaving Pathfinder", async () => {
    const user = userEvent.setup();
    const startingUrl = window.location.href;
    render(<App />);

    await user.dblClick(screen.getByRole("radio", { name: /ask something else/i }));
    await user.dblClick(screen.getByRole("radio", { name: /unfired work ready to bring in/i }));
    await user.click(screen.getByRole("button", { name: /that answers it/i }));

    const heading = screen.getByRole("heading", { name: /what would you like a quick answer on/i });
    expect(heading).toBeVisible();
    expect(heading).toHaveFocus();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getAllByRole("radio").every((radio) => !radio.checked)).toBe(true);
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    expect(window.location.href).toBe(startingUrl);
  });

  it("copies a prepared readiness request without a dropoff estimate note or print sheet", async () => {
    const user = userEvent.setup();
    const clipboardSpy = vi.spyOn(navigator.clipboard, "writeText");
    mockSuccess({ emailQueued: true, supportRequestId: "pathfinder-abc123" });
    render(<App />);
    await chooseOther(user, /unfired work ready to bring in/i);
    await user.click(screen.getByRole("button", { name: /ask the studio/i }));

    const request = screen.getByRole("article", { name: /your question/i });
    expect(request).not.toHaveTextContent(sharedBillingPolicy);
    expect(document.querySelector(".print-ticket-sheet")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Name or nickname"), "Sam Potter");
    await user.type(screen.getByRole("textbox", { name: /^email/i }), "sam@example.com");
    await acceptLegal(user);
    await user.click(screen.getByRole("button", { name: /^send my question$/i }));
    await user.click(await screen.findByRole("button", { name: /copy question/i }));

    expect(clipboardSpy).toHaveBeenCalledOnce();
    expect(clipboardSpy.mock.calls[0][0]).not.toContain(sharedBillingPolicy);
    expect(clipboardSpy.mock.calls[0][0]).not.toMatch(/completely dry|dryness/i);
    expect(screen.getByRole("button", { name: /^copied$/i })).toBeVisible();
  });

  it("keeps cone numbers in dismissible help instead of primary labels", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.dblClick(screen.getByRole("radio", { name: /drop off work/i }));
    const help = screen.getByRole("button", { name: /cone reference for low fire/i });
    await user.click(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/cone 06–04/i);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });

  it("uses double-click as an optional select-and-advance shortcut on valid choices", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.dblClick(screen.getByRole("radio", { name: /drop off work/i }));
    expect(screen.getByRole("heading", { name: /which firing comes next/i })).toBeVisible();
    await user.dblClick(screen.getByRole("radio", { name: /mid fire/i }));
    expect(screen.getByRole("heading", { name: /how much kiln space/i })).toBeVisible();
    await user.dblClick(screen.getByRole("radio", { name: /^1 half shelf/i }));
    expect(screen.getByRole("heading", { name: /your mid-fire dropoff/i })).toBeVisible();
  });
});


describe("first-time firing clarity", () => {
  it("estimates cone 10 and requires scheduling confirmation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("radio", { name: /drop off work/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("radio", { name: /^cone 10 electric oxidation/i }));
    await user.click(screen.getByRole("button", { name: /next: estimate kiln space/i }));
    expect(screen.getByRole("heading", { name: /how much kiln space/i })).toBeVisible();
    expect(screen.getByText(/Heads-up.*\$135/i)).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /^3 half shelves/i }));
    await user.click(screen.getByRole("button", { name: /see my estimate/i }));
    expect(screen.getByText("$135 estimated", { exact: true })).toBeVisible();
    expect(screen.getByText(/shared cone 10 runs require scheduling confirmation/i)).toBeVisible();
  });
});
