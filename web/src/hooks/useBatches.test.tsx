/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import { useBatches } from "./useBatches";

type MockConstraint =
  | { type: "where"; field: string; op: string; value: unknown }
  | { type: "orderBy"; field: string; direction: "asc" | "desc" };
type MockCollectionRef = { path: string };
type MockQuery = { path: string; constraints: MockConstraint[] };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };
type TestUser = User & { uid: string };

type GetDocsMock = (queryRef: MockQuery) => Promise<Snapshot>;
let getDocsMock: GetDocsMock;

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function permissionDeniedError() {
  const error = new Error("Missing or insufficient permissions");
  (error as Error & { code: string }).code = "permission-denied";
  return error;
}

function isActiveQuery(queryRef: MockQuery): boolean {
  return queryRef.constraints.some(
    (constraint) =>
      constraint.type === "where" && constraint.field === "isClosed" && constraint.op === "==" && constraint.value === false
  );
}

function isHistoryQuery(queryRef: MockQuery): boolean {
  return queryRef.constraints.some(
    (constraint) =>
      constraint.type === "where" && constraint.field === "isClosed" && constraint.op === "==" && constraint.value === true
  );
}

function createUser(uid = "batch-user"): TestUser {
  return {
    uid,
    email: "maker@monsoonfire.com",
  } as unknown as TestUser;
}

function Harness({ user }: { user: User | null }) {
  const { active, history, error } = useBatches(user);
  return (
    <div>
      <div data-testid="active-count">{active.length}</div>
      <div data-testid="history-count">{history.length}</div>
      <div data-testid="error">{error}</div>
    </div>
  );
}

vi.mock("../firebase", () => ({
  db: { name: "mock-db" },
}));

vi.mock("firebase/firestore", () => {
  const collection = vi.fn((_: unknown, path: string) => ({ path }));
  const where = vi.fn((field: string, op: string, value: unknown) => ({ type: "where" as const, field, op, value }));
  const orderBy = vi.fn((field: string, direction: "asc" | "desc" = "asc") => ({
    type: "orderBy" as const,
    field,
    direction,
  }));
  const query = vi.fn((source: MockCollectionRef | MockQuery, ...constraints: MockConstraint[]) => ({
    path: source.path,
    constraints: [...("constraints" in source ? source.constraints : []), ...constraints],
  }));
  return {
    collection,
    where,
    orderBy,
    query,
    getDocs: (queryRef: MockQuery) => getDocsMock(queryRef),
  };
});

beforeEach(() => {
  getDocsMock = async () => createSnapshot([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useBatches", () => {
  it("keeps readable batches when one query is denied and reports partial error", async () => {
    const user = createUser("user-partial");
    getDocsMock = async (queryRef) => {
      if (isActiveQuery(queryRef)) {
        throw permissionDeniedError();
      }
      if (isHistoryQuery(queryRef)) {
        return createSnapshot([
          {
            id: "batch-history-1",
            data: { ownerUid: user.uid, title: "History batch", isClosed: true },
          },
        ]);
      }
      return createSnapshot([]);
    };

    render(<Harness user={user} />);

    await waitFor(() => {
      expect(screen.getByTestId("active-count").textContent).toBe("0");
      expect(screen.getByTestId("history-count").textContent).toBe("1");
    });

    const message = screen.getByTestId("error").textContent ?? "";
    expect(message).toContain("Some check-ins could not be loaded.");
    expect(message).toContain("support code:");
  });

  it("returns full error when both active and history queries are denied", async () => {
    const user = createUser("user-denied");
    getDocsMock = async (queryRef) => {
      if (isActiveQuery(queryRef) || isHistoryQuery(queryRef)) {
        throw permissionDeniedError();
      }
      return createSnapshot([]);
    };

    render(<Harness user={user} />);

    await waitFor(() => {
      const errorText = screen.getByTestId("error").textContent ?? "";
      expect(errorText.length).toBeGreaterThan(0);
      expect(errorText).toContain("support code:");
      expect(screen.getByTestId("active-count").textContent).toBe("0");
      expect(screen.getByTestId("history-count").textContent).toBe("0");
    });
  });

  it("clears stale batches and errors when user signs out", async () => {
    const signedInUser = createUser("user-signout");
    getDocsMock = async (queryRef) => {
      if (isActiveQuery(queryRef)) {
        return createSnapshot([
          {
            id: "batch-active-1",
            data: { ownerUid: signedInUser.uid, title: "Active batch", isClosed: false },
          },
        ]);
      }
      if (isHistoryQuery(queryRef)) {
        return createSnapshot([]);
      }
      return createSnapshot([]);
    };

    const { rerender } = render(<Harness user={signedInUser} />);

    await waitFor(() => {
      expect(screen.getByTestId("active-count").textContent).toBe("1");
      expect(screen.getByTestId("history-count").textContent).toBe("0");
    });

    rerender(<Harness user={null} />);

    await waitFor(() => {
      expect(screen.getByTestId("active-count").textContent).toBe("0");
      expect(screen.getByTestId("history-count").textContent).toBe("0");
      expect(screen.getByTestId("error").textContent).toBe("");
    });
  });
});
