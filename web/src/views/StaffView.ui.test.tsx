/** @vitest-environment jsdom */

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("../firebase", () => ({
  db: {},
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(async () => ({ id: "mock-doc" })),
  arrayUnion: vi.fn((...values: unknown[]) => values),
  collection: vi.fn((...segments: unknown[]) => ({ kind: "collection", segments })),
  doc: vi.fn((...segments: unknown[]) => ({ kind: "doc", segments })),
  documentId: vi.fn(() => "__name__"),
  getCountFromServer: vi.fn(async () => ({
    data: () => ({ count: 0 }),
  })),
  getDocs: vi.fn(async () => ({
    docs: [],
    empty: true,
    forEach: (_fn: (doc: unknown) => void) => undefined,
  })),
  limit: vi.fn((value: number) => ({ kind: "limit", value })),
  orderBy: vi.fn((field: string, direction?: string) => ({ kind: "orderBy", field, direction })),
  query: vi.fn((...parts: unknown[]) => ({ kind: "query", parts })),
  serverTimestamp: vi.fn(() => ({ ".sv": "timestamp" })),
  startAfter: vi.fn((value: unknown) => ({ kind: "startAfter", value })),
  setDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: "where", field, op, value })),
}));

vi.mock("firebase/storage", () => ({
  connectStorageEmulator: vi.fn(),
  getDownloadURL: vi.fn(async () => ""),
  getStorage: vi.fn(() => ({})),
  ref: vi.fn((...segments: unknown[]) => ({ kind: "storage-ref", segments })),
  uploadBytes: vi.fn(async () => ({ metadata: {} })),
}));

let pickupTickets: Array<{ ticketId: string; displayName: string; status: string; billingStatus: string }> = [];
let pickupQueueUnavailable = false;
const postJsonMock = vi.fn(async (fn: string, body?: { ticketId?: string }) => {
  switch (fn) {
    case "staffListFiringPickupReviews":
      if (pickupQueueUnavailable) throw new Error("Temporary ticket queue failure");
      return { data: { tickets: pickupTickets, runtime: {
        stripeMode: "test", invoicesEnabled: true, firingBillingEnabled: true, liveWritesEnabled: false,
      } } };
    case "staffFinalizeFiringPickup":
      pickupTickets = pickupTickets.map((ticket) => ticket.ticketId === body?.ticketId
        ? { ...ticket, status: "ready_for_pickup", billingStatus: "invoice_open" }
        : ticket);
      return { ok: true };
    case "apiV1/v1/library.items.list":
      return { data: { items: [] } };
    case "apiV1/v1/library.staff.dashboard":
      return { data: { requests: [], loans: [], coverReviews: [], tagSubmissions: [] } };
    case "apiV1/v1/library.recommendations.list":
      return { data: { recommendations: [] } };
    case "apiV1/v1/library.externalLookup.providerConfig.get":
      return { data: {} };
    case "apiV1/v1/library.rollout.get":
      return { data: { phase: "phase_3_admin_full", memberWritesEnabled: true } };
    case "staffGetFiringTicketCreationOptions":
      return { data: { people: [], firings: [], limits: { users: 0, profiles: 0, firings: 0 } } };
    default:
      return {};
  }
});

vi.mock("../api/functionsClient", () => ({
  createFunctionsClient: vi.fn(() => ({
    postJson: postJsonMock,
    getLastRequest: () => null,
    getLastCurl: () => "",
  })),
  safeJsonStringify: JSON.stringify,
}));

vi.mock("../utils/functionsBaseUrl", () => ({
  resolveFunctionsBaseUrlResolution: () => ({
    baseUrl: "http://127.0.0.1:5001/monsoonfire-portal/us-central1/apiV1",
    configured: false,
    enabled: true,
    reason: "",
  }),
}));

vi.mock("./staff/CockpitModule", () => ({
  default: ({
    cockpitOpsContent,
    announcementComposerOpen,
  }: {
    cockpitOpsContent: ReactNode;
    announcementComposerOpen?: boolean;
  }) => (
    <div data-testid="cockpit-module">
      {announcementComposerOpen ? <div data-testid="cockpit-announcement-composer-open">Announcement composer open</div> : null}
      {cockpitOpsContent}
    </div>
  ),
}));

vi.mock("./staff/CockpitOpsPanel", () => ({
  default: ({
    operationsContent,
    reservationNotificationPolicyContent,
    firingPickupBillingContent,
    accessRoleContent,
    cockpitTab,
  }: {
    cockpitTab: string;
    operationsContent: ReactNode;
    reservationNotificationPolicyContent?: ReactNode;
    firingPickupBillingContent?: ReactNode;
    accessRoleContent?: ReactNode;
  }) => (
    <div data-testid="cockpit-ops-panel">
      <div data-testid="cockpit-current-tab">{cockpitTab}</div>
      {reservationNotificationPolicyContent ? (
        <div data-testid="cockpit-reservation-policy">{reservationNotificationPolicyContent}</div>
      ) : null}
      {operationsContent}
      {cockpitTab === "finance" ? firingPickupBillingContent : null}
      {cockpitTab === "policyAgentOps" ? accessRoleContent : null}
    </div>
  ),
}));

vi.mock("./staff/StudioBrainControlTowerModule", () => ({
  default: ({ disabled }: { disabled: boolean }) => (
    <div data-testid="control-tower-sentinel" data-disabled={disabled ? "true" : "false"}>
      Control Tower sentinel
    </div>
  ),
}));

vi.mock("./staff/LendingModule", () => ({
  default: () => <div data-testid="lending-sentinel">Lending sentinel</div>,
}));

vi.mock("./staff/LendingIntakeModule", () => ({
  default: () => <div data-testid="lending-intake-sentinel">Lending intake sentinel</div>,
}));

vi.mock("./staff/useStaffEventSignupAutoLoad", () => ({
  useStaffEventSignupAutoLoad: vi.fn(),
}));

import StaffView from "./StaffView";
import { getDocs } from "firebase/firestore";

function buildUser(): User {
  return {
    uid: "staff-1",
    email: "staff@example.com",
    displayName: "Staff User",
    isAnonymous: false,
    getIdToken: vi.fn(async () => "test-token"),
    getIdTokenResult: vi.fn(async () => ({ claims: {} })),
  } as unknown as User;
}

describe("StaffView cockpit routing", () => {
  it("shows a partial-results warning when a later directory page fails", async () => {
    const empty = { docs: [], empty: true, forEach: () => undefined };
    const docs = Array.from({ length: 240 }, (_, i) => ({ id: `partial-${i}`, data: () => ({ displayName: `Person ${i}` }) }));
    vi.mocked(getDocs).mockImplementation(async (value) => {
      const parts = (value as unknown as { parts: Array<{ kind?: string; segments?: string[] }> }).parts;
      if (parts?.[0]?.segments?.at(-1) === "users") {
        if (parts.some((part) => part.kind === "startAfter")) throw new Error("Page unavailable");
        return { docs } as never;
      }
      return empty as never;
    });
    try {
      window.history.replaceState({}, "", "/staff/cockpit/members");
      render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} forceCockpitWorkspace />);
      expect(await screen.findByText("Some contacts may be missing. Refresh contacts to retry.")).toBeTruthy();
      expect(screen.getAllByText("Person 0").length).toBeGreaterThan(0);
    } finally {
      vi.mocked(getDocs).mockImplementation(async () => empty as never);
    }
  });

  it("loads later directory pages and makes the next contact searchable", async () => {
    const empty = { docs: [], empty: true, forEach: () => undefined };
    const docs = Array.from({ length: 240 }, (_, i) => ({ id: `user-${i}`, data: () => ({ displayName: `Person ${i}` }) }));
    const last = { id: "user-final", data: () => ({ displayName: "Later Contact", email: "later@example.com" }) };
    vi.mocked(getDocs).mockImplementation(async (value) => {
      const parts = (value as unknown as { parts: Array<{ kind?: string; segments?: string[] }> }).parts;
      const name = parts?.[0]?.segments?.at(-1);
      const cursor = parts?.some((part) => part.kind === "startAfter");
      return (name === "users" ? { docs: cursor ? [last] : docs } : empty) as never;
    });
    try {
      window.history.replaceState({}, "", "/staff/cockpit/members");
      render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} forceCockpitWorkspace />);
      const search = await screen.findByLabelText("Search contacts by name or email");
      fireEvent.change(search, { target: { value: "Later Contact" } });
      expect(await screen.findByText("Later Contact")).toBeTruthy();
      expect(screen.queryByText("Some contacts may be missing. Refresh contacts to retry.")).toBeNull();
    } finally {
      vi.mocked(getDocs).mockImplementation(async () => empty as never);
    }
  });
  beforeEach(() => {
    postJsonMock.mockClear();
    pickupTickets = [];
    pickupQueueUnavailable = false;
    window.history.replaceState({}, "", "/staff/cockpit/operations");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({
          version: 1, generatedAtMs: Date.now(), issues: [],
          workflows: [{
            key: "prodSmoke", label: "Production Smoke", workflowFile: "portal-prod-smoke.yml", outputHint: "",
            runUrl: "", status: "completed", conclusion: "success", createdAtMs: Date.now(),
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens staff ticket creation from the workspace instead of the public planner", async () => {
    const onOpenCheckin = vi.fn();
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined}
      devAdminEnabled={false} showEmulatorTools={false} onOpenCheckin={onOpenCheckin} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New firing ticket" }));
    expect(await screen.findByRole("heading", { name: "New firing ticket" })).toBeTruthy();
    expect(await screen.findByLabelText("Find client")).toBeTruthy();
    expect(onOpenCheckin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "New firing ticket" })).toBeNull();
  });

  it("omits the reservations marker while bookings are paused", async () => {
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} />);
    const overview = await screen.findByRole("region", { name: "Studio overview" });
    expect(within(overview).getByRole("img")).toBeTruthy();
    expect(overview.querySelectorAll(".staff-studio-marker")).toHaveLength(5);
    expect(overview.querySelector(".staff-studio-marker-calendar")).toBeNull();
  });

  it("keeps reservation records in Archived tools without promoting booking", async () => {
    const onOpenCheckin = vi.fn();
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} onOpenCheckin={onOpenCheckin} />);
    const daily = screen.getByRole("navigation", { name: "Daily work" });
    expect(within(daily).queryByRole("button", { name: "Reservations", exact: true })).toBeNull();
    fireEvent.click(screen.getByText("Archived tools", { exact: true }));
    const archive = screen.getByRole("navigation", { name: "Archived staff tools" });
    fireEvent.click(within(archive).getByRole("button", { name: "Reservation records", exact: true }));
    await waitFor(() => expect(window.location.pathname).toBe("/staff/cockpit/studio-reservations"));
    expect(within(archive).getByRole("button", { name: "Reservation records", exact: true }).getAttribute("aria-current")).toBe("page");
    expect(onOpenCheckin).not.toHaveBeenCalled();
  });

  it("shows missing automation data as unavailable and routes to Automation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Rate limit exceeded", { status: 403 })));
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} />);
    const item = await screen.findByTestId("staff-task-home-attention-automation-status-unavailable");
    expect(item.textContent).toContain("Automation status unavailable");
    fireEvent.click(within(item).getByRole("button", { name: "Review automation" }));
    await waitFor(() => expect(window.location.pathname).toBe("/staff/cockpit/automation"));
  });

  it("opens an exact pickup review and removes it from Today only after it is saved", async () => {
    const fixture = {
      email: "artist@example.com", status: "awaiting_pickup_review", billingStatus: "unbilled", noticeStatus: "not_queued",
      billingVersion: 0, heatId: "mid", heatLabel: "Mid fire", requestedSpaceId: "double",
      finalChargeCents: null, currency: "usd", otherRequestedServices: [],
    };
    pickupTickets = [
      { ...fixture, ticketId: "MF-1001-TEST", displayName: "First Artist" },
      { ...fixture, ticketId: "MF-1002-TEST", displayName: "Second Artist" },
    ];
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} />);
    const second = await screen.findByTestId("staff-task-home-attention-pickup-review-MF-1002-TEST");
    fireEvent.click(within(second).getByRole("button", { name: "Open ticket" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Second Artist/ }).getAttribute("aria-pressed")).toBe("true"), { timeout: 8000 });
    await screen.findByDisplayValue("50.00");
    fireEvent.click(within(screen.getByRole("group", { name: "Ticket actions" })).getByRole("button", { name: "Mark ready & send pickup email" }));
    await waitFor(() => expect(postJsonMock).toHaveBeenCalledWith(
      "staffFinalizeFiringPickup", expect.objectContaining({ ticketId: "MF-1002-TEST" }), expect.anything(),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Today", exact: true }));
    expect(await screen.findByTestId("staff-task-home-attention-pickup-review-MF-1001-TEST")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("staff-task-home-attention-pickup-review-MF-1002-TEST")).toBeNull());
  }, 15000);

  it("lets staff retry an unavailable pickup queue without declaring Today clear", async () => {
    pickupQueueUnavailable = true;
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} />);
    const retry = await screen.findByRole("button", { name: "Retry ticket check" });
    expect(screen.queryByText("All clear")).toBeNull();
    pickupQueueUnavailable = false;
    fireEvent.click(retry);
    expect(await screen.findByText("All clear")).toBeTruthy();
  });
  it.each([
    ["kiln", "View kiln schedule fallback", "/staff/cockpit/firings"],
    ["counter", "Open tickets", "/staff/cockpit/finance"],
  ])("opens the %s workflow from the studio", async (marker, _action, route) => {
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} />);
    const overview = await screen.findByRole("region", { name: "Studio overview" });
    fireEvent.click(overview.querySelector(`.staff-studio-marker-${marker}`)!);
    await waitFor(() => expect(window.location.pathname).toBe(route));
  });
  it("opens messages from the studio overview", async () => {
    const onOpenMessages = vi.fn(); window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} onOpenMessages={onOpenMessages} />);
    const overview = await screen.findByRole("region", { name: "Studio overview" });
    fireEvent.click(overview.querySelector(".staff-studio-marker-desk")!);
    await waitFor(() => expect(window.location.pathname).toBe("/staff/cockpit/messages"));
    expect(onOpenMessages).not.toHaveBeenCalled();
  });
  it("opens the announcement composer from the studio overview", async () => {
    window.history.replaceState({}, "", "/staff");
    render(<StaffView user={buildUser()} isStaff devAdminToken="" onDevAdminTokenChange={() => undefined} devAdminEnabled={false} showEmulatorTools={false} />);
    const overview = await screen.findByRole("region", { name: "Studio overview" });
    fireEvent.click(overview.querySelector(".staff-studio-marker-shelves")!);
    await waitFor(() => expect(window.location.pathname).toBe("/staff/cockpit"));
    expect(await screen.findByTestId("cockpit-announcement-composer-open")).toBeTruthy();
  });

  it("opens lending from operations overview without falling back to the generic cockpit overview", async () => {
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    const lendingArea = await screen.findByTestId("operations-area-lending");
    fireEvent.click(within(lendingArea).getByRole("button", { name: "Open lending" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/staff/cockpit/lending");
    });
    expect(await screen.findByTestId("operations-focus-lending")).toBeTruthy();
    expect(await screen.findByTestId("lending-sentinel")).toBeTruthy();
    expect(screen.queryByTestId("operations-overview")).toBeNull();
  });

  it("renders the browser control tower on the canonical control-tower route", async () => {
    window.history.replaceState({}, "", "/staff/cockpit/control-tower");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
      />
    );

    const controlTower = await screen.findByTestId("control-tower-sentinel");
    expect(controlTower).toBeTruthy();
    expect(controlTower.getAttribute("data-disabled")).toBe("false");
  });

  it("maps legacy /staff/system navigation to the cockpit platform tab", async () => {
    window.history.replaceState({}, "", "/staff/system");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("platform");
    });
    expect(screen.queryByTestId("staff-module-system")).toBeNull();
  });

  it("maps legacy /staff/overview navigation to cockpit triage tab", async () => {
    window.history.replaceState({}, "", "/staff/overview");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("triage");
    });
  });

  it("opens operation deep-links as focused operations modules inside cockpit", async () => {
    window.history.replaceState({}, "", "/staff/cockpit/lending-intake");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
    expect(screen.getByTestId("operations-focus-lending-intake")).toBeTruthy();
    expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("operations");
    });
    expect(screen.queryByTestId("operations-overview")).toBeNull();
  });

  it("maps legacy cockpit module alias paths to the correct tab", async () => {
    window.history.replaceState({}, "", "/staff/cockpit/commerce");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("finance");
    });
  });

  it("maps cockpit policy/tab alias variants to policy & agent ops", async () => {
    window.history.replaceState({}, "", "/staff/policyagentops");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("policyAgentOps");
    });
  });

  it("maps cockpit module telemetry alias paths to the moduleTelemetry tab", async () => {
    window.history.replaceState({}, "", "/staff/cockpit/moduleTelemetry");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("moduleTelemetry");
    });
  });

  it("maps legacy /staff/lendingIntake deep-link to focused lending-intake operations module", async () => {
    window.history.replaceState({}, "", "/staff/lendingIntake");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
    expect(screen.getByTestId("operations-focus-lending-intake")).toBeTruthy();
    expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("operations");
    });
    expect(screen.queryByTestId("operations-overview")).toBeNull();
  });

  it("shows role management controls for admins in policies", async () => {
    window.history.replaceState({}, "", "/staff/members");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        isAdmin
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh contacts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Policies & integrations" }));
    expect(await screen.findByRole("heading", { name: "Access & roles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save role change" })).toBeTruthy();
    const roleSelect = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(Array.from(roleSelect.options).map((option) => option.value)).toEqual(["member", "staff", "admin"]);
  });

  it("keeps role management read-only for staff without admin authority", async () => {
    window.history.replaceState({}, "", "/staff/members");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh contacts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Policies & integrations" }));
    expect(await screen.findByRole("heading", { name: "Access & roles" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save role change" })).toBeNull();
    expect(screen.getByText(/Admin claim required to change roles\./)).toBeTruthy();
  });

  it("normalizes content-only initialModule values into cockpit tab state", async () => {
    window.history.replaceState({}, "", "/staff/cockpit");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        initialModule="system"
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("platform");
    });
  });

  it("normalizes commerce initialModule into finance tab state and keeps cockpit surface", async () => {
    window.history.replaceState({}, "", "/staff/cockpit");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        initialModule="commerce"
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("finance");
    });
    expect(screen.queryByTestId("staff-module-commerce")).toBeNull();
  });

  it("renders reservation notification policy defaults in safe mode on the cockpit platform tab", async () => {
    window.history.replaceState({}, "", "/staff/cockpit/platform");
    render(
      <StaffView
        user={buildUser()}
        isStaff
        devAdminToken=""
        onDevAdminTokenChange={() => undefined}
        devAdminEnabled={false}
        showEmulatorTools={false}
        forceCockpitWorkspace
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-current-tab").textContent).toBe("platform");
    });

    expect(await screen.findByText("Reservation notification policy")).toBeTruthy();
    expect(
      screen.getByText(
        "Functions emulator is local, but Auth emulator is off. StaffView is running in Firestore-only safe mode for function-backed modules."
      )
    ).toBeTruthy();

    const pickupReadyNotice = screen.getByLabelText("Pickup-ready notice") as HTMLInputElement;
    const pickupReminders = screen.getByLabelText("Pickup reminders") as HTMLInputElement;
    const reminderMode = screen.getByLabelText("Reminder timing mode") as HTMLSelectElement;
    const saveButton = screen.getByRole("button", { name: "Save notification policy" }) as HTMLButtonElement;

    expect(pickupReadyNotice.checked).toBe(true);
    expect(pickupReadyNotice.disabled).toBe(true);
    expect(pickupReminders.checked).toBe(true);
    expect(pickupReminders.disabled).toBe(true);
    expect(reminderMode.value).toBe("storage_window_ratio");
    expect(reminderMode.disabled).toBe(true);
    expect(screen.getByDisplayValue("336, 420, 462")).toBeTruthy();
    expect(screen.getByLabelText("Pickup-window closing reminder")).toBeTruthy();
    expect(screen.getByLabelText("Closing reminder lead time (hours)").getAttribute("value")).toBe("24");
    expect(screen.getByLabelText("First delay follow-up (hours)").getAttribute("value")).toBe("12");
    expect(screen.getByLabelText("Repeat delay follow-up every (hours)").getAttribute("value")).toBe("24");
    expect(saveButton.disabled).toBe(true);
  });
});
