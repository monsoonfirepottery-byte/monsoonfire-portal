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

const postJsonMock = vi.fn(async (fn: string) => {
  switch (fn) {
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

vi.mock("./staff/CockpitModule", () => ({
  default: ({ cockpitOpsContent }: { cockpitOpsContent: ReactNode }) => (
    <div data-testid="cockpit-module">{cockpitOpsContent}</div>
  ),
}));

vi.mock("./staff/CockpitOpsPanel", () => ({
  default: ({ operationsContent, cockpitTab }: { cockpitTab: string; operationsContent: ReactNode }) => (
    <div data-testid="cockpit-ops-panel">
      <div data-testid="cockpit-current-tab">{cockpitTab}</div>
      {operationsContent}
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

function buildUser(): User {
  return {
    uid: "staff-1",
    email: "staff@example.com",
    displayName: "Staff User",
    getIdToken: vi.fn(async () => "test-token"),
  } as unknown as User;
}

describe("StaffView cockpit routing", () => {
  beforeEach(() => {
    postJsonMock.mockClear();
    window.history.replaceState({}, "", "/staff/cockpit/operations");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ workflow_runs: [] }), {
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
    expect(screen.getByTestId("operations-focus-lending")).toBeTruthy();
    expect(screen.getByTestId("lending-sentinel")).toBeTruthy();
    expect(screen.queryByTestId("operations-overview")).toBeNull();
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

  it("shows in-app role management controls for admins in the members module", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh members" }));
    expect(await screen.findByText("Access role")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh members" }));
    expect(await screen.findByText("Access role")).toBeTruthy();
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
});
