
// web/src/App.tsx
// Clean version enforcing Continue Journey visibility rules:
// - Continue Journey ONLY on closed batches
// - Disabled if any active batch exists

import React, { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  createPortalApi,
  PortalApiError,
  type PortalApiMeta,
  type CreateBatchRequest,
  type PickedUpAndCloseRequest,
  type ContinueJourneyRequest,
} from "./api/portalApi";

type Batch = {
  id: string;
  title?: string;
  ownerUid?: string;
  estimatedCostCents?: number;
  priceCents?: number;
  intakeMode?: string;
  status?: string;
  isClosed?: boolean;
  updatedAt?: Timestamp;
  closedAt?: Timestamp;
};

const DEV_ADMIN_TOKEN_STORAGE_KEY = "mf_dev_admin_token";

export default function App() {
  const api = useMemo(() => createPortalApi(), []);

  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState("");
  const [adminToken, setAdminToken] = useState(() =>
    localStorage.getItem(DEV_ADMIN_TOKEN_STORAGE_KEY) || ""
  );

  const [active, setActive] = useState<Batch[]>([]);
  const [history, setHistory] = useState<Batch[]>([]);
  const [lastReq, setLastReq] = useState<PortalApiMeta | null>(null);

  const hasActive = active.length > 0;

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    localStorage.setItem(DEV_ADMIN_TOKEN_STORAGE_KEY, adminToken);
  }, [adminToken]);

  useEffect(() => {
    if (!user) return;

    const uid = user.uid;

    const unsubActive = onSnapshot(
      query(
        collection(db, "batches"),
        where("ownerUid", "==", uid),
        where("isClosed", "==", false),
        orderBy("updatedAt", "desc")
      ),
      (snap) => setActive(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    );

    const unsubHistory = onSnapshot(
      query(
        collection(db, "batches"),
        where("ownerUid", "==", uid),
        where("isClosed", "==", true),
        orderBy("closedAt", "desc")
      ),
      (snap) => setHistory(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    );

    return () => {
      unsubActive();
      unsubHistory();
    };
  }, [user]);

  async function ensureIdToken() {
    if (!user) throw new Error("Not signed in");
    return user.getIdToken();
  }

  async function createTestBatch() {
    if (!user) return;
    try {
      const payload: CreateBatchRequest = {
        ownerUid: user.uid,
        ownerDisplayName: user.displayName || user.email || "Client",
        title: "Test batch",
        intakeMode: "STAFF_HANDOFF",
        estimatedCostCents: 2500,
      };
      const { meta } = await api.createBatch({
        idToken: await ensureIdToken(),
        adminToken: adminToken || undefined,
        payload,
      });
      setLastReq(meta);
      setStatus("Batch created");
    } catch (e: any) {
      if (e instanceof PortalApiError) setLastReq(e.meta);
      setStatus(e.message);
    }
  }

  async function pickedUpAndClose(batchId: string) {
    try {
      const payload: PickedUpAndCloseRequest = { batchId, uid: user!.uid };
      const { meta } = await api.pickedUpAndClose({
        idToken: await ensureIdToken(),
        adminToken: adminToken || undefined,
        payload,
      });
      setLastReq(meta);
      setStatus("Batch closed");
    } catch (e: any) {
      if (e instanceof PortalApiError) setLastReq(e.meta);
      setStatus(e.message);
    }
  }

  async function continueJourney(batchId: string) {
    try {
      const payload: ContinueJourneyRequest = {
        uid: user!.uid,
        fromBatchId: batchId,
      };
      const { meta } = await api.continueJourney({
        idToken: await ensureIdToken(),
        adminToken: adminToken || undefined,
        payload,
      });
      setLastReq(meta);
      setStatus("Journey continued");
    } catch (e: any) {
      if (e instanceof PortalApiError) setLastReq(e.meta);
      setStatus(e.message);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Monsoon Fire Portal</h1>
      <div>Functions base: <b>{api.baseUrl}</b></div>

      {user ? (
        <button onClick={() => signOut(auth)}>Sign out</button>
      ) : (
        <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
          Sign in
        </button>
      )}

      <hr />

      <input
        placeholder="admin token"
        value={adminToken}
        onChange={(e) => setAdminToken(e.target.value)}
      />
      <button onClick={createTestBatch}>Create test batch</button>

      <h2>Active</h2>
      {active.map(b => (
        <div key={b.id}>
          {b.title} — {b.id}
          <button onClick={() => pickedUpAndClose(b.id)}>Close</button>
        </div>
      ))}

      <h2>History</h2>
      {history.map(b => (
        <div key={b.id}>
          {b.title} — {b.id}
          <button
            disabled={hasActive}
            title={hasActive ? "Close active batch first" : undefined}
            onClick={() => continueJourney(b.id)}
          >
            Continue journey
          </button>
        </div>
      ))}

      <pre>{JSON.stringify(lastReq, null, 2)}</pre>
      <div>{status}</div>
    </div>
  );
}
